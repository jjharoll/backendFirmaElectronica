# Utiliza una imagen base de Node.js
FROM node:14

# Establece el directorio de trabajo en la aplicación
WORKDIR /app

# Copia los archivos de la aplicación al contenedor
COPY package.json package-lock.json /app/
COPY server.js /app/

# Instala las dependencias
RUN npm install --production

# Expone el puerto 3001
EXPOSE 3001

# Define el comando de inicio del contenedor
CMD ["node", "server.js"]
