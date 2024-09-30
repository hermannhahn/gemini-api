require('dotenv').config();
import express from 'express';
const sqlite3 = require('sqlite3').verbose();

const app = express();

// enable JSON body parser
app.use(express.json());

// Conectar ao banco de dados
const db = new sqlite3.Database('short_memory.db');

// Criar a tabela (se não existir)
db.run(`
    CREATE TABLE IF NOT EXISTS short_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        role TEXT,
        memory TEXT,
        data DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);
db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        password TEXT,
        name TEXT,
        data DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Função para adicionar uma memory
function addMessage(userId: string, role: string, memory: string) {
  db.run('INSERT INTO short_memory (user_id, role, memory) VALUES (?, ?, ?)', [userId, role, memory], (err: any) => {
    if (err) {
      console.error(err.message);
    }
  });

  // Remover mensagens mais antigas que 33 minutos
  db.run('DELETE FROM short_memory WHERE data < datetime("now", "-33 minutes")');
}

// Função para ler memória de curto prazo
function readShortMemory(userId: string) {
  return new Promise((resolve, reject) => {
    db.all('SELECT user_id, role, memory FROM short_memory WHERE user_id = ? ORDER BY data ASC', [userId], (err: any, rows: any[]) => {
      if (err) {
        reject(err);
      } else {
        // Informar nome na primeira linha do histórico depois preencher com o histórico
        resolve(rows.map(row => ({ role: row.role, parts: [{ text: row.memory }] })));
      }
    });
  });
}

// Importa a biblioteca do Gemini
const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  systemInstruction: "Você é uma assistente e amiga. O nome do seu patrão é Hermann. Seu nome é Gemini mas seu patrão sempre de chama de Mimi. Você se comporta como uma mulher. Se te perguntarem algo referente há algo que foi conversado antes mas não está no histórico, diga que não se lembra, peça para te lembrar."
});

const generationConfig = {
  temperature: 1.4,
  topP: 0.95,
  topK: 64,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

// Default route
//app.get('/', (req, res) => {
//    res.send('API Gemini Working!');
//});

// Rota para receber a pergunta
app.get('/', async (req, res) => {
    const userId = req.query.userId; // Assumindo que o ID do usuário seja passado como parâmetro
    const ask = req.query.ask;
    console.log(userId, ask);

    try {
      // Adiciona a pergunta ao histórico
      addMessage((userId || "").toString(), "user", (ask || "").toString());
      // Cria uma nova sessão de chat
      const chatSession = model.startChat({
        generationConfig,
        // safetySettings: Adjust safety settings
        // See https://ai.google.dev/gemini-api/docs/safety-settings
        history: await readShortMemory((userId || "").toString()),
        // safetySettings: {
        //   harmBlockThreshold: HarmBlockThreshold.HIGH,
        //   harmCategory: HarmCategory.ALL,
        // },
      });

      // Envia solicitação
      const result = await chatSession.sendMessage(ask)
      const answer = result.response.text();

      // Adiciona a resposta ao histórico
      addMessage((userId || "").toString(), "model", answer);
      
      // Retorna a resposta do Gemini
      res.json({ result: [ask, answer] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao processar a pergunta' });
  }
});

// Feche a conexão com o banco de dados quando o servidor parar
process.on('SIGINT', () => {
    db.close((err: any) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Conexão com o banco de dados fechada.');
        process.exit(0);
    });
});
  
export default app;
