const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

// Crea il server web che smista le due pagine
const server = http.createServer((req, res) => {
  // Se l'indirizzo finisce con /umberto, mostra la tua console segreta
  const fileDaAprire = req.url === '/umberto' ? 'umberto.html' : 'index.html';

  fs.readFile(fileDaAprire, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Pagina non trovata');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

let utentiConnessi = new Set();
let consoleUmberto = null;

wss.on('connection', (ws) => {
  ws.on('message', (messaggio) => {
    const dati = JSON.parse(messaggio);

    // Registrazione ruoli
    if (dati.tipo === 'registra') {
      if (dati.ruolo === 'utente') {
        utentiConnessi.add(ws);
        if (consoleUmberto) {
          consoleUmberto.send(JSON.stringify({ azione: 'info', testo: '🟢 Un nuovo utente è entrato nella chat!' }));
        }
      } else if (dati.ruolo === 'umberto') {
        consoleUmberto = ws;
      }
      return;
    }

    // Domanda o Stop dall'utente -> vanno alla Console di Umberto
    if (dati.mittente === 'utente' && consoleUmberto) {
      consoleUmberto.send(JSON.stringify(dati));
    }

    // Risposta da Umberto -> va agli utenti in chat
    if (dati.mittente === 'umberto') {
      utentiConnessi.forEach((utente) => {
        if (utente.readyState === WebSocket.OPEN) {
          utente.send(JSON.stringify(dati));
        }
      });
    }
  });

  ws.on('close', () => {
    utentiConnessi.delete(ws);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server NOVA attivo sulla porta ${PORT}`);
});
