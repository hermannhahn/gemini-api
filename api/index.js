require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = process.env.PORT || 3000; // Porta onde o servidor irá escutar

// Conectar ao banco de dados
const db = new sqlite3.Database('conversas.db');

// Criar a tabela (se não existir)
db.run(`
  CREATE TABLE IF NOT EXISTS conversas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id TEXT,
    nome TEXT,
    role TEXT,
    mensagem TEXT,
    data DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Função para adicionar uma mensagem
function adicionarMensagem(usuarioId, nome, role, mensagem) {
  db.run('INSERT INTO conversas (usuario_id, nome, role, mensagem) VALUES (?, ?, ?, ?)', [usuarioId, nome, role, mensagem], (err) => {
    if (err) {
      console.error(err.message);
    }
  });

  // Remover mensagens mais antigas que 33 minutos
  db.run('DELETE FROM conversas WHERE data < datetime("now", "-33 minutes")');
}

// Função para ler histório de um usuário
function lerHistorico(usuarioId) {
  return new Promise((resolve, reject) => {
    db.all('SELECT nome, role, mensagem FROM conversas WHERE usuario_id = ? ORDER BY data ASC', [usuarioId], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        // Informar nome na primeira linha do histórico depois preencher com o histórico
        resolve(rows.map(row => ({ role: row.role, parts: [{ text: row.nome + ": " + row.mensagem }] })));
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
  systemInstruction: "Você é uma assistente útil. O nome do seu patrão é Hermann. Seu nome é Gemini. Você se comporta como uma mulher. Se te perguntarem algo referente há algo que foi conversado antes mas não está no histórico, diga que não se lembra, peça para te lembrar."
});

const generationConfig = {
  temperature: 1.4,
  topP: 0.95,
  topK: 64,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

// Default route
app.get('/', (req, res) => {
  res.send('API Gemini funcionando!');
});


// Rota para receber a pergunta
app.get('/ask', async (req, res) => {
    const pergunta = req.query.pergunta;
    const usuarioId = req.query.usuarioId; // Assumindo que o ID do usuário seja passado como parâmetro
    const nome = req.query.nome; // Assumindo que o nome do usuário seja passado como parâmetro



    // Exibe no console
    //console.log("\n")
    //console.log("Pergunta recebida:\n")
    //console.log(pergunta)

    try {
      // Adiciona a pergunta ao histórico
      adicionarMensagem(usuarioId, nome, "user", pergunta);
      // Cria uma nova sessão de chat
      const chatSession = model.startChat({
        generationConfig,
        // safetySettings: Adjust safety settings
        // See https://ai.google.dev/gemini-api/docs/safety-settings
        history: await lerHistorico(usuarioId),
        // safetySettings: {
        //   harmBlockThreshold: HarmBlockThreshold.HIGH,
        //   harmCategory: HarmCategory.ALL,
        // },
      });

      // Envia solicitação
      const query = nome + ": " + pergunta;
      const result = await chatSession.sendMessage(query)
      const resposta = result.response.text();

      // Adiciona a resposta ao histórico
      adicionarMensagem(usuarioId, "Gemini", "model", resposta);
      
      //console.log("Resposta enviada:\n")
      //console.log(resposta)
      //console.log("\n")
      
      // Retorna a resposta do Gemini
      res.json({ result: [pergunta, resposta] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao processar a pergunta' });
  }
});

app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});

// Feche a conexão com o banco de dados quando o servidor parar
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Conexão com o banco de dados fechada.');
    process.exit(0);
  });
});

