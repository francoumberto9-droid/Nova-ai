const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

const API_KEY = process.env.GEMINI_API_KEY;

const server = http.createServer((req, res) => {
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
  let interrotto = false;

  ws.on('message', async (messaggio) => {
    const dati = JSON.parse(messaggio);

    if (dati.tipo === 'registra') {
      if (dati.ruolo === 'utente') {
        utentiConnessi.add(ws);
        if (consoleUmberto && consoleUmberto.readyState === WebSocket.OPEN) {
          consoleUmberto.send(JSON.stringify({ azione: 'info', testo: '🟢 Un nuovo utente è entrato nella chat!' }));
        }
      } else if (dati.ruolo === 'umberto') {
        consoleUmberto = ws;
      }
      return;
    }

    if (dati.mittente === 'utente' && dati.azione === 'stop') {
      interrotto = true;
      if (consoleUmberto && consoleUmberto.readyState === WebSocket.OPEN) {
        consoleUmberto.send(JSON.stringify(dati));
      }
      return;
    }

    if (dati.mittente === 'utente' && dati.azione === 'domanda') {
      interrotto = false;

      if (consoleUmberto && consoleUmberto.readyState === WebSocket.OPEN) {
        consoleUmberto.send(JSON.stringify(dati));
      } else {
        if (!API_KEY) {
          ws.send(JSON.stringify({ azione: 'risposta', testo: "⚠️ Chiave API non configurata su Render!" }));
          return;
        }

        try {
          const risposta = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: {
                  parts: [{ text: "Ti chiami NOVA. Sei un'intelligenza artificiale brillante, simpatica, diretta e utile." }]
                },
                contents: [{ parts: [{ text: dati.testo }] }]
              })
            }
          );

          const json = await risposta.json();
          const testoAI = json.candidates?.[0]?.content?.parts?.[0]?.text || `Errore Google: ${json.error?.message || JSON.stringify(json)}`;

          if (!interrotto && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ azione: 'risposta', testo: testoAI }));
          }
        } catch (errore) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ azione: 'risposta', testo: `Errore di connessione: ${errore.message}` }));
          }
        }
      }
    }

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
    if (ws === consoleUmberto) {
      consoleUmberto = null;
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server NOVA Ibrido attivo sulla porta ${PORT}`);
});
