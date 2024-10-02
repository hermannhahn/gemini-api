import express from 'express';
import sqlite3 from 'sqlite3';
import * as dotenv from 'dotenv';
import bcrypt from 'bcrypt';


dotenv.config();
const app = express();
const port = process.env.PORT || 3000; // Porta onde o servidor irá escutar

// Conectar ao banco de dados
const db = new sqlite3.Database('memory.db');

// Criar tabela de usuários
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    password TEXT,
    api_key TEXT,
    data DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Criar memória de curto prazo
db.run(`
  CREATE TABLE IF NOT EXISTS shortmemory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    role TEXT,
    memory TEXT,
    data DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Função para obter o usuário da chave api informada
function getUserByApiKey(apiKey: string) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE api_key = ?', [apiKey], (err: any, row: any) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Função para obter dados do usuário
function getUserByUserId(userId: string) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err: any, row: any) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Middleware para autenticação
app.use(async (req: any, res: any, next: any) => {

  if (req.path == '/ask') {

    const apiKey = req.headers.authorization;
    if (!apiKey) {
      return res.status(401).json({ error: 'API key não fornecida' });
    }

    try {
      const user = await getUserByApiKey(apiKey);
      if (!user) {
        return res.status(401).json({ error: 'API key inválida' });
      }
      req.user = user;
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erro ao verificar a API key' });
    }
  }
  next();
});

// Rota para criar um novo usuário
app.post('/register', async (req: any, res: any) => {

  // Verifica se existe body na requisição
  if (!req.headers) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  // Verifica se foi informado o usuário e senha por URLEncoded
  const userId = req.headers.userid;
  const password = req.headers.password;

  // Verifica se o usuário e senha foram informados
  if (!userId || !password) {
    return res.status(400).json({ error: 'User e-mail and password are required' });
  }


  try {
    // Verifica se o usuário já existe
    const existingUser = await getUserByUserId(userId);
    if (existingUser) {
      return res.status(400).json({ error: 'User e-mail already registered' });
    }

    // Gera uma nova API key
    const apiKey = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    // Encripta a senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insere o novo usuário no banco de dados
    db.run('INSERT INTO users (user_id, password, api_key) VALUES (?, ?, ?)', [userId, hashedPassword, apiKey], (err: any) => {
      if (err) {
        console.error(err.message);
        return res.status(500).json({ error: 'Error while creating user' });
      }
      res.json({ success: true, api_key: apiKey });
      console.log("New user created: " + userId);
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error while creating user' });
  }
});

// Rota para obter a API key
app.post('/login', async (req: any, res: any) => {
  const userId = req.headers.userid;
  const password = req.headers.password;

  // Verifica se o usuário e senha foram informados
  if (!userId || !password) {
    return res.status(400).json({ error: 'User e-mail and password are required' });
  }

  // Verifica se o usuário existe
  const user: any = await getUserByUserId(userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  // Compara as senhas utilizando o hash e data
  const isPasswordValid: any = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Retorna a API Key do usuário
  res.json({ success: true, api_key: user.api_key });
});

// Função para adicionar memória de curto prazo
function addToShortMemory(userId: string, role: string, memory: string) {
  db.run('INSERT INTO shortmemory (user_id, role, memory) VALUES (?, ?, ?)', [userId, role, memory], (err: any) => {
    if (err) {
      console.error(err.message);
    }
  });

  // Apaga memórias anteriores a 33 minutos
  db.run('DELETE FROM shortmemory WHERE data < datetime("now", "-33 minutes")');
}

// Função para ler histório de um usuário
function lastMemories(userId: string) {
  return new Promise((resolve, reject) => {
    db.all('SELECT user_id, role, memory FROM shortmemory WHERE user_id = ? ORDER BY data ASC', [userId], (err: any, rows: any[]) => {
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
  systemInstruction: "Você é uma assistente e amiga. Seu nome é Gemini. O nome do seu patrão e amigo é Hermann. Você se comporta como uma mulher. Se te perguntarem algo referente há algo que foi conversado antes mas não está no histórico, diga que não se lembra, peça para te lembrar."
});

const generationConfig = {
  temperature: 1.4,
  topP: 0.95,
  topK: 64,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

// Default route
app.get('/', (req: any, res: any) => {
  res.send('API Gemini funcionando!');
});


// Rota para receber a pergunta
app.get('/ask', async (req: any, res: any) => {
    const question: any = req.query.question;
    // Pega o userId da api key informada no header pela key authorization
    const userId: any = await getUserByApiKey(req.headers.authorization)

    // Verifica se o userId da API Key existe
    if (!userId) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Verifica se a pergunta foi informada
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    try {
      // Adiciona a memoria de curto prazo
      addToShortMemory(userId, "user", question);
      // Cria uma nova sessão de chat
      const chatSession = model.startChat({
        generationConfig,
        // safetySettings: Adjust safety settings
        // See https://ai.google.dev/gemini-api/docs/safety-settings
        history: await lastMemories(userId),
        // safetySettings: {
        //   harmBlockThreshold: HarmBlockThreshold.HIGH,
        //   harmCategory: HarmCategory.ALL,
        // },
      });

      // Envia solicitação
      const result = await chatSession.sendMessage(question)
      const answer = result.response.text();

      // Adiciona a resposta ao histórico
      addToShortMemory(userId, "model", answer);
      
      // Retorna a resposta do Gemini
      res.json({ answer: [answer] });

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
  db.close((err: any) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Conexão com o banco de dados fechada.');
    process.exit(0);
  });
});

