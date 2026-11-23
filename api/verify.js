export default async function handler(req, res) {
  // Permitem doar cereri POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodă nepermisă. Folosește POST.' });
  }

  const { content } = req.body;

  if (!content || content.trim().length < 15) {
    return res.status(400).json({ error: 'Introdu un text de știre sau un link valid (minim 15 caractere).' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Lipsește cheia GEMINI_API_KEY în setările Vercel.' });
  }

  const prompt = `Ești un expert jurnalist de investigații și fact-checker din România. 
Analizează textul sau link-ul de mai jos și verifică în timp real pe internet dacă informația este reală, parțial adevărată, clickbait/manipulare sau falsă (fake news).

Știre de verificat:
"""
${content}
"""

Răspunde STRICT în format JSON valid (fără markdown \`\`\`json, fără text în afara acoladelor), respectând exact această structură:
{
  "verdict": "ADEVĂRAT" | "PARȚIAL ADEVĂRAT" | "MANIPULARE / CLICKBAIT" | "FALS" | "NEVERIFICABIL",
  "scor_credibilitate": 0-100,
  "rezumat": "Explicație clară și directă în 2-3 propoziții despre ce este real și ce este fals în această știre.",
  "semnale_alarma": ["lista cu tehnici de manipulare găsite sau 'Niciun semnal major'"],
  "surse_gasite": [
    { "titlu": "Numele publicației sau articolului", "url": "link-ul sursei credibile găsite" }
  ]
}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // Activăm căutarea live pe Google pentru verificare în timp real
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.2
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || 'Eroare la comunicarea cu Gemini 4 Hydrogen.'
      });
    }

    let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Curățăm eventualele blocuri markdown dacă modelul le adaugă
    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

    const parsedResult = JSON.parse(rawText);

    // Extragem și link-urile reale returnate de Google Search Grounding (dacă există)
    const groundingChunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const webSources = groundingChunks
      .filter(chunk => chunk.web?.uri && chunk.web?.title)
      .map(chunk => ({ titlu: chunk.web.title, url: chunk.web.uri }));

    if (webSources.length > 0 && (!parsedResult.surse_gasite || parsedResult.surse_gasite.length === 0)) {
      parsedResult.surse_gasite = webSources.slice(0, 4);
    }

    return res.status(200).json(parsedResult);
  } catch (error) {
    return res.status(500).json({
      error: 'Nu s-a putut procesa răspunsul AI. Încearcă din nou.',
      details: error.message
    });
  }
}
