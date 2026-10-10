FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY sdk ./sdk
COPY public ./public
COPY games ./games
COPY apk ./apk
ENV PORT=7777
EXPOSE 7777
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]
