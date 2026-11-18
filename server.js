const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

const API_KEY = process.env.GEMINI_API_KEY;

const server = http.createServer((req, res) => {
  fs.readFile('index.html', (err, data) => {
    if (err) {
      res.writeHead(500);
      return res.end('Errore nel caricamento della pagina');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let interrotto = false;

  ws.on('message', async (messaggio) => {
    const dati = JSON.parse(messaggio);

    if (dati.azione === 'stop') {
      interrotto = true;
      return;
    }

    if (dati.azione === 'domanda') {
      interrotto = false;

      if (!API_KEY) {
        ws.send(JSON.stringify({ azione: 'risposta', testo: "⚠️ Chiave API non configurata su Render!" }));
        return;
      }

      try {
        const risposta = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
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
        const testoAI = json.candidates?.[0]?.content?.parts?.[0]?.text || "Non sono riuscita a elaborare una risposta.";

        if (!interrotto) {
          ws.send(JSON.stringify({ azione: 'risposta', testo: testoAI }));
        }
      } catch (errore) {
        ws.send(JSON.stringify({ azione: 'risposta', testo: "Ops, errore di connessione con il server AI." }));
      }
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Sito AI attivo sulla porta ${PORT}`);
});