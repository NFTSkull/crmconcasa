FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production

CMD ["sh", "-c", "node src/server.js & pid=$!; sleep 3; node -e \"fetch('http://127.0.0.1:3002/e2e-real-expediente-20260917-once').then(async r=>{console.log('E2E_LOCAL_STATUS',r.status);console.log('E2E_LOCAL_BODY',await r.text())}).catch(e=>console.error('E2E_LOCAL_ERROR',e.name,e.message))\"; wait $pid"]
