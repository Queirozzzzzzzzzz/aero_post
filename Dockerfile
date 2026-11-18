FROM node:22-alpine
WORKDIR /app
COPY server.js index.html ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5757 DATA_DIR=/data
USER node
EXPOSE 5757
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:5757/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
