export async function POST(request) {
  try {
    const { question, choices, correct } = await request.json();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Gemini API Key is not configured on the server." }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const promptText = `Please explain the following question from the EA (Enrolled Agent) exam.\nQuestion: ${question}\nChoices:\n${choices.map(c => c.letter + '. ' + c.text).join('\n')}\nCorrect Answer: ${correct}\n\nProvide a concise, helpful explanation of why the correct answer is correct and why the other options may be incorrect or how to remember this concept.\n\nIMPORTANT: Write the explanation in Simplified Chinese, but KEEP all professional terminology, financial terms, and tax concepts in English to help with the exam studies.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const explanationText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No explanation generated.";

    return new Response(JSON.stringify({ explanation: explanationText }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error("AI Explanation Server error:", err);
    return new Response(JSON.stringify({ error: err.message || "Failed to generate AI explanation." }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
