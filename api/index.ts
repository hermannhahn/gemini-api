require('dotenv').config();
import express from 'express';

const app = express();

// enable JSON body parser
app.use(express.json());

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
    // Cria uma nova sessão de chat
    const chatSession = model.startChat({
      generationConfig,
      // safetySettings: Adjust safety settings
      // See https://ai.google.dev/gemini-api/docs/safety-settings
      history: [],
      // safetySettings: {
      //   harmBlockThreshold: HarmBlockThreshold.HIGH,
      //   harmCategory: HarmCategory.ALL,
      // },
    });

    // Envia solicitação
    const result = await chatSession.sendMessage(ask)
    const answer = result.response.text();
    
    // Retorna a resposta do Gemini
    res.json({ result: [ask, answer] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao processar a pergunta' });
  }

});
  
export default app;
