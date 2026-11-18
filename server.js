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

let utentiConnessi = []; // Lista ordinata degli utenti online
let utenteAttivo = null; // L'utente con cui stai parlando ora
let consoleUmberto = null;
let contatoreUtenti = 1;

function aggiornaStatoConsole() {
  if (consoleUmberto && consoleUmberto.readyState === WebSocket.OPEN) {
    consoleUmberto.send(JSON.stringify({
      azione: 'stato',
      utenteCorrente: utenteAttivo ? utenteAttivo.nome : 'Nessuno',
      totaleOnline: utentiConnessi.length
    }));
  }
}

wss.on('connection', (ws) => {
  let interrotto = false;

  ws.on('message', async (messaggio) => {
    const dati = JSON.parse(messaggio);

    // 1. Registrazione ruoli
    if (dati.tipo === 'registra') {
      if (dati.ruolo === 'utente') {
        ws.nome = `Utente #${contatoreUtenti++}`;
        utentiConnessi.push(ws);

        // Se non stai parlando con nessuno, aggancia subito questo utente
        if (!utenteAttivo) {
          utenteAttivo = ws;
        }

        if (consoleUmberto && consoleUmberto.readyState === WebSocket.OPEN) {
          consoleUmberto.send(JSON.stringify({ azione: 'info', testo: `🟢 ${ws.nome} è entrato in chat!` }));
        }
        aggiornaStatoConsole();
      } else if (dati.ruolo === 'umberto') {
        consoleUmberto = ws;
        if (!utenteAttivo && utentiConnessi.length > 0) {
          utenteAttivo = utentiConnessi[0];
        }
        aggiornaStatoConsole();
      }
      return;
    }

    // 2. Bottone "Finisci e passa al prossimo utente"
    if (dati.mittente === 'umberto' && dati.azione === 'prossimo_utente') {
      if (utentiConnessi.length === 0) {
        utenteAttivo = null;
      } else if (utentiConnessi.length === 1) {
        utenteAttivo = utentiConnessi[0];
        if (consoleUmberto) {
          consoleUmberto.send(JSON.stringify({ azione: 'info', testo: `ℹ️ C'è solo ${utenteAttivo.nome} collegato al momento.` }));
        }
      } else {
        // Sposta l'utente attuale in fondo alla lista e prende il successivo
        const indiceAttuale = utentiConnessi.indexOf(utenteAttivo);
        const prossimoIndice = (indiceAttuale + 1) % utentiConnessi.length;
        utenteAttivo = utentiConnessi[prossimoIndice];
        if (consoleUmberto) {
          consoleUmberto.send(JSON.stringify({ azione: 'info', testo: `🔄 Conversazione passata a ${utenteAttivo.nome}!` }));
        }
      }
      aggiornaStatoConsole();
      return;
    }

    // 3. Stop dall'utente
    if (dati.mittente === 'utente' && dati.azione === 'stop') {
      interrotto = true;
      if (ws === utenteAttivo && consoleUmberto && consoleUmberto.readyState === WebSocket.OPEN) {
        consoleUmberto.send(JSON.stringify({ azione: 'stop', utente: ws.nome }));
      }
      return;
    }

    // 4. Domanda dall'utente
    if (dati.mittente === 'utente' && dati.azione === 'domanda') {
      interrotto = false;

      // Se la console è aperta E questo è l'utente con cui stai parlando -> rispondi tu!
      if (consoleUmberto && consoleUmberto.readyState === WebSocket.OPEN && ws === utenteAttivo) {
        consoleUmberto.send(JSON.stringify({ azione: 'domanda', utente: ws.nome, testo: dati.testo }));
      } 
      // Altrimenti (console chiusa OPPURE utente in attesa mentre parli con un altro) -> risponde Gemini!
      else {
        if (consoleUmberto && consoleUmberto.readyState === WebSocket.OPEN && ws !== utenteAttivo) {
          consoleUmberto.send(JSON.stringify({ azione: 'info', testo: `🤖 (${ws.nome} ha scritto: "${dati.testo}" — gestito da Gemini in automatico)` }));
        }

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

    // 5. Risposta manuale inviata da Umberto (va SOLO all'utente attivo!)
    if (dati.mittente === 'umberto' && dati.azione === 'risposta') {
      if (utenteAttivo && utenteAttivo.readyState === WebSocket.OPEN) {
        utenteAttivo.send(JSON.stringify({ azione: 'risposta', testo: dati.testo }));
      }
    }
  });

  ws.on('close', () => {
    utentiConnessi = utentiConnessi.filter(u => u !== ws);
    if (ws === utenteAttivo) {
      if (consoleUmberto && consoleUmberto.readyState === WebSocket.OPEN) {
        consoleUmberto.send(JSON.stringify({ azione: 'info', testo: `🔴 ${ws.nome} ha chiuso la chat.` }));
      }
      utenteAttivo = utentiConnessi.length > 0 ? utentiConnessi[0] : null;
    }
    aggiornaStatoConsole();

    if (ws === consoleUmberto) {
      consoleUmberto = null;
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server NOVA Multi-Utente attivo sulla porta ${PORT}`);
});
