const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const AWS = require('aws-sdk');
const sql = require('mssql');

const app = express();
const port = 3001;

app.use(cors());
app.use('/uploads', express.static('backend/uploads'));
app.use(express.json({ limit: '50mb' }));

const s3 = new AWS.S3({
  accessKeyId: 'AKIAWPTUCDTRGWJO5TGX',
secretAccessKey: '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',
});
const bucketName = 'consentimientoinformado';

const dbConfig = {
  user: 'admin',
  password: 'admin123',
  server: 'clintos.czzdknftpzkc.us-east-2.rds.amazonaws.com',
  database: 'LOG_CONSENTIMIENTO',
  options: {
    encrypt: true,
    trustServerCertificate: true,
    port: 1433,
    requestTimeout: 30000,
    connectionTimeout: 30000,
  },
};

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage: storage }).single('pdf');

app.post('/upload', upload, async (req, res) => {
  const { id_documento, pdf } = req.body;
  const decodedPDF = Buffer.from(pdf, 'base64');

  const filename = `file_${Date.now()}.pdf`;
  const filePath = `uploads/${filename}`;
  const frontendURL = 'http://localhost:3000';

  fs.writeFile(filePath, decodedPDF, async (err) => {
    if (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Error al guardar el archivo PDF.' });
    } else {
      try {
        const mergedPDFPath = await mergePDFs(filePath, 'documents/leyes_consentimiento.pdf');

        // Cargar el archivo PDF en S3
        const fileContent = await fs.promises.readFile(mergedPDFPath);
        await uploadToS3(id_documento, filename, fileContent);

        const fileURL = `${frontendURL}/pdf/${id_documento}`;
        res.json({ success: true, message: 'PDF recibido y procesado correctamente.', url: fileURL });
      } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Error al combinar los archivos PDF.' });
      }
    }
  });
});

async function mergePDFs(file1Path, file2Path) {
  const file1Content = await fs.promises.readFile(file1Path);
  const file2Content = await fs.promises.readFile(file2Path);

  const mergedPDF = await PDFDocument.create();

  const [file1, file2] = await Promise.all([
    PDFDocument.load(file1Content),
    PDFDocument.load(file2Content),
  ]);

  const file1Pages = await mergedPDF.copyPages(file1, file1.getPageIndices());
  const file2Pages = await mergedPDF.copyPages(file2, file2.getPageIndices());

  file1Pages.forEach((page) => mergedPDF.addPage(page));
  file2Pages.forEach((page) => mergedPDF.addPage(page));

  const mergedPDFPath = `uploads/merged_${Date.now()}.pdf`;
  const mergedPDFBytes = await mergedPDF.save();
  await fs.promises.writeFile(mergedPDFPath, mergedPDFBytes);

  return mergedPDFPath;
}

async function uploadToS3(id_documento, filename, fileContent) {
  const params = {
    Bucket: bucketName,
    Key: filename,
    Body: fileContent,
  };

  try {
    await s3.upload(params).promise();

    await insertPDFToDatabase(id_documento, filename, fileContent.toString('base64'));
  } catch (error) {
    console.error('Error al cargar el archivo PDF en S3:', error);
    throw error;
  }
}

async function insertPDFToDatabase(id_documento, filename, base64PDF) {
  try {
    const pool = await sql.connect(dbConfig);
    const ps = new sql.PreparedStatement(pool);

    const query = `
      INSERT INTO [dbo].[Consentimientos]
      ([log_id_consentimiento],[log_base64], [log_fechainsercion])
      VALUES (@logId, @base64PDF, GETDATE())
    `;

    ps.input('logId', sql.NVarChar);
    ps.input('base64PDF', sql.NVarChar);

    await ps.prepare(query);
    await ps.execute({
      logId: id_documento,
      base64PDF: base64PDF,
    });
    await ps.unprepare();

    sql.close();
  } catch (error) {
    console.error('Error al insertar el PDF en la base de datos:', error);
    throw error;
  }
}

app.get('/pdf/:id', async (req, res) => {
  const id = req.params.id;

  try {
    await sql.connect(dbConfig);

    const query = `
      SELECT [log_id_consentimiento], [log_base64]
      FROM [dbo].[Consentimientos]
      WHERE [log_id_consentimiento] = @logId
    `;

    const ps = new sql.PreparedStatement();
    ps.input('logId', sql.Int);

    await ps.prepare(query);

    const result = await ps.execute({
      logId: id,
    });

    const filename = result.recordset[0].log_id_consentimiento;
    const base64PDF = result.recordset[0].log_base64;
    
    await ps.unprepare();
    await sql.close();

    const decodedPDF = Buffer.from(base64PDF, 'base64');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=${filename}`);
    res.send(decodedPDF);
  } catch (error) {
    console.error('Error al obtener el PDF desde la base de datos:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el PDF desde la base de datos.' });
  }
});

app.listen(port, () => {
  console.log(`Servidor iniciado en el puerto ${port}`);
});
