"use client";

import { useState, useRef, useEffect } from "react";
import jsPDF from "jspdf";

const STORAGE_KEY = "ea_trainer_notes";

export default function Home() {
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [mode, setMode] = useState("flash");
  const [languageMode, setLanguageMode] = useState("en");
  const [notes, setNotes] = useState({});
  const [currentDatasetKey, setCurrentDatasetKey] = useState("");
  const [currentDatasetLabel, setCurrentDatasetLabel] = useState("");
  const [dataStatus, setDataStatus] = useState("No dataset loaded.");

  // Modals
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showQuestionModal, setShowQuestionModal] = useState(false);

  const [noteText, setNoteText] = useState("");
  const [questionJsonText, setQuestionJsonText] = useState("");
  const [explanationLoading, setExplanationLoading] = useState(false);

  const fileInputRef = useRef(null);
  const projectInputRef = useRef(null);

  // Load from local storage on mount based on dataset key
  useEffect(() => {
    if (currentDatasetKey) {
      try {
        const stored = localStorage.getItem(`${STORAGE_KEY}_${currentDatasetKey}`);
        if (stored) {
          setNotes(JSON.parse(stored));
        }
      } catch (err) {
        console.error("Failed to parse notes", err);
      }
    }
  }, [currentDatasetKey]);

  // Save to local storage when notes change
  useEffect(() => {
    if (currentDatasetKey && Object.keys(notes).length > 0) {
      localStorage.setItem(`${STORAGE_KEY}_${currentDatasetKey}`, JSON.stringify(notes));
    }
  }, [notes, currentDatasetKey]);

  const handleCSVUpload = (evt) => {
    const file = evt.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsedQuestions = loadQuestionsFromCSV(reader.result);
        setQuestions(parsedQuestions);
        setDatasetIdentity(file.name);
        setDataStatus(`${parsedQuestions.length} questions loaded from ${file.name}.`);
        setMode('flash');
        setIndex(0);
        setFlipped(false);
      } catch (error) {
        alert('Unable to read CSV file. Please confirm the format.');
        console.error(error);
      }
    };
    reader.readAsText(file);
    evt.target.value = ""; // reset
  };

  const handleProjectUpload = (evt) => {
    const file = evt.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        mergeProjectPayload(JSON.parse(reader.result));
        setMode('flash');
      } catch (err) {
        alert('Unable to load project file.');
        console.error(err);
      }
    };
    reader.readAsText(file);
    evt.target.value = ""; // reset
  };

  const explainWithAI = async () => {
    if (!questions.length) return;
    const q = questions[index];

    setExplanationLoading(true);

    // Optimistically show loading in notes
    setNotes(prev => ({ ...prev, [q.id]: (prev[q.id] ? prev[q.id] + '\n\n' : '') + '<i>Generating AI explanation...</i>' }));

    try {
      const response = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q.question,
          choices: q.choices,
          correct: q.correct
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `API error: ${response.status}`);
      }

      setNotes(prev => {
        // Remove the temporary loading text
        let existingNote = prev[q.id] || '';
        existingNote = existingNote.replace('<i>Generating AI explanation...</i>', '').trim();
        return {
          ...prev,
          [q.id]: (existingNote ? existingNote + '\n\n' : '') + `[AI Explanation]\n${data.explanation}`
        };
      });

    } catch (err) {
      console.error("AI Explanation error:", err);
      alert(`Failed to generate AI explanation: ${err.message}`);
    } finally {
      setExplanationLoading(false);
    }
  };

  const exportProject = () => {
    if (!questions.length) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      questionCount: questions.length,
      datasetName: currentDatasetLabel || 'dataset',
      datasetKey: currentDatasetKey,
      questions,
      notes
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    const base = (currentDatasetLabel || 'dataset')
      .replace(/[^a-zA-Z0-9-_]+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '') || 'dataset';

    link.download = `${base}_project.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportNotesToPDF = async () => {
    // Filter only saved notes
    const savedNotes = Object.entries(notes).filter(([, text]) => text && text.trim().length);

    if (savedNotes.length === 0) {
      alert("No notes to export.");
      return;
    }

    // Since jsPDF struggles with custom Unicode TTFs directly, we'll build an invisible HTML
    // container with all our formatted notes, and then use html2pdf to snapshot the native
    // browser rendering (which perfectly understands generic 'sans-serif' Chinese fonts).
    const container = document.createElement("div");
    container.style.padding = "20px";
    container.style.fontFamily = "sans-serif"; // The browser evaluates this as native PC Chinese support
    container.style.color = "#000";

    savedNotes.forEach(([idStr, noteText], index) => {
      const qid = Number(idStr);
      const q = questions.find((item) => item.id === qid);

      const section = document.createElement("div");
      // Force page break between sections if not the first
      if (index > 0) section.style.pageBreakBefore = "always";

      let htmlContent = `
        <div style="page-break-inside: avoid; break-inside: avoid;">
          <h2 style="font-size: 18px; font-weight: bold; margin-bottom: 16px;">Question ${qid}</h2>
        </div>
      `;

      if (q) {
        // Question Text
        htmlContent += `
        <div style="page-break-inside: avoid; break-inside: avoid; margin-bottom: 12px;">
          <p style="font-size: 14px; margin: 0;">Q: ${q.question}</p>
        </div>`;

        // Choices
        htmlContent += `<ul style="list-style-type: none; padding-left: 12px; font-size: 14px; margin-bottom: 16px; margin-top: 0;">`;
        q.choices.forEach(choice => {
          htmlContent += `<li style="margin-bottom: 8px; page-break-inside: avoid; break-inside: avoid;">${choice.letter}. ${choice.text}</li>`;
        });
        htmlContent += `</ul>`;

        // Correct Answer
        htmlContent += `
        <div style="page-break-inside: avoid; break-inside: avoid; margin-bottom: 24px;">
          <p style="font-size: 14px; font-weight: bold; margin: 0;">Correct: ${q.correct}</p>
        </div>`;
      }

      // User Note / AI Explanation
      htmlContent += `
      <div style="page-break-inside: avoid; break-inside: avoid; margin-bottom: 8px;">
        <h3 style="font-size: 16px; font-weight: bold; margin: 0;">Notes:</h3>
      </div>`;

      // Preserve line breaks from the user's note by using white-space: pre-wrap
      const paragraphs = noteText.split('\n');
      paragraphs.forEach(pText => {
        if (pText.trim() || pText.length > 0) {
          htmlContent += `
          <div style="page-break-inside: avoid; break-inside: avoid; margin-bottom: 6px;">
            <p style="font-size: 14px; white-space: pre-wrap; line-height: 1.5; margin: 0;">${pText || '&nbsp;'}</p>
          </div>`;
        }
      });

      section.innerHTML = htmlContent;
      container.appendChild(section);
    });

    // Import html2pdf dynamically so Next.js doesn't try to Server-Side Render this client library
    const html2pdf = (await import('html2pdf.js')).default;

    const base = (currentDatasetLabel || "dataset").replace(/[^a-zA-Z0-9-_]+/g, "_");
    const opt = {
      margin: 10,
      filename: `${base}_notes.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    html2pdf().from(container).set(opt).save();
  };

  // Utility to convert ArrayBuffer to Base64 for jsPDF
  const arrayBufferToBase64 = (buffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  const checkPageBreak = (doc, yPos, margin, lineHeight) => {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (yPos + lineHeight > pageHeight - margin) {
      doc.addPage();
      return margin;
    }
    return yPos;
  };

  // --- Helper Functions ---

  const setDatasetIdentity = (label) => {
    const derived = deriveDatasetLabel(label);
    setCurrentDatasetLabel(derived);
    setCurrentDatasetKey(sanitizeDatasetKey(derived));
  };

  const deriveDatasetLabel = (name) => {
    if (!name) return 'dataset';
    const base = name.replace(/\.[^/.]+$/, '').trim();
    return base || 'dataset';
  };

  const sanitizeDatasetKey = (value) => {
    return (value || 'dataset')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'dataset';
  };

  const loadQuestionsFromCSV = (text) => {
    const rows = parseCSV(text);
    if (!rows.length) {
      throw new Error('CSV is empty');
    }
    const header = rows.shift().map(h => h.trim());
    const idx = {
      id: header.indexOf('Question #'),
      question: header.indexOf('Question Text'),
      choiceLetter: header.indexOf('Choice'),
      choiceText: header.indexOf('Choice Text'),
      explanation: header.indexOf('Explanation'),
      isCorrect: header.indexOf('Is Correct')
    };
    if (Object.values(idx).some(value => value === -1)) {
      throw new Error('CSV headers missing required columns');
    }
    const grouped = {};
    rows.forEach(row => {
      const rawId = row[idx.id];
      if (!rawId || isNaN(rawId)) return;
      const qid = parseInt(rawId, 10);
      if (!grouped[qid]) {
        grouped[qid] = {
          id: qid,
          question: row[idx.question] || '',
          choices: [],
          explanation: row[idx.explanation] || '',
          correct: ''
        };
      }
      grouped[qid].choices.push({
        letter: (row[idx.choiceLetter] || '').trim(),
        text: row[idx.choiceText] || ''
      });
      if (String(row[idx.isCorrect]).trim().toLowerCase() === 'true') {
        grouped[qid].correct = (row[idx.choiceLetter] || '').trim();
        grouped[qid].explanation = row[idx.explanation] || grouped[qid].explanation;
      }
    });
    return Object.values(grouped).sort((a, b) => a.id - b.id);
  };

  const parseCSV = (text) => {
    const rows = [];
    let current = [];
    let value = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (inQuotes && text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        current.push(value);
        value = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && text[i + 1] === '\n') i++;
        current.push(value);
        rows.push(current);
        current = [];
        value = '';
      } else {
        value += char;
      }
    }
    if (value || current.length) {
      current.push(value);
      rows.push(current);
    }
    return rows.filter(row => row.some(cell => cell && cell.trim() !== ''));
  };

  const mergeProjectPayload = (payload) => {
    if (!payload || !Array.isArray(payload.questions) || !payload.questions.length) {
      throw new Error('Missing questions');
    }
    const datasetName = (payload.datasetName && payload.datasetName.trim()) ? payload.datasetName : 'project';
    const incomingQuestions = payload.questions.slice();
    const incomingNotes = (payload.notes && typeof payload.notes === 'object') ? payload.notes : {};

    if (questions.length === 0) {
      setQuestions(incomingQuestions.sort((a, b) => a.id - b.id));
      setIndex(0);
      setFlipped(false);
      setDatasetIdentity(datasetName);
      setNotes(incomingNotes);
      setDataStatus(`Project "${datasetName}" loaded (${incomingQuestions.length} questions, ${Object.keys(incomingNotes).length} notes).`);
      return;
    }

    if (!currentDatasetKey) {
      setDatasetIdentity(datasetName);
    }

    const lookup = new Map(questions.map((q, idx) => [q.id, idx]));
    let added = 0;
    let updated = 0;
    let nextQuestions = [...questions];

    incomingQuestions.forEach(q => {
      if (!q || typeof q !== 'object') return;
      if (lookup.has(q.id)) {
        const idx = lookup.get(q.id);
        nextQuestions[idx] = q;
        updated++;
      } else {
        nextQuestions.push(q);
        lookup.set(q.id, nextQuestions.length - 1);
        added++;
      }
    });

    nextQuestions.sort((a, b) => a.id - b.id);
    setQuestions(nextQuestions);
    setNotes(prev => ({ ...prev, ...incomingNotes }));
    setFlipped(false);
    setDataStatus(`Merged project "${datasetName}" (${incomingQuestions.length} questions: ${added} new, ${updated} updated). Total ${nextQuestions.length} questions, ${Object.keys(notes).length} notes.`);
  };

  const addQuestionFromModal = () => {
    const raw = questionJsonText.trim();
    if (!raw) {
      alert('Paste a question JSON payload before adding.');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      alert('Invalid JSON. Please ensure the question is valid JSON.');
      return;
    }
    const payloads = Array.isArray(parsed) ? parsed : [parsed];
    let added = 0;
    let lastAddedId = null;

    let nextQuestions = [...questions];

    // Normalize and add
    payloads.forEach(item => {
      try {
        const normalized = normalizeQuestionPayload(item);
        const existingIndex = nextQuestions.findIndex(q => q.id === normalized.id);
        if (existingIndex !== -1) {
          nextQuestions[existingIndex] = normalized;
        } else {
          nextQuestions.push(normalized);
        }
        added++;
        lastAddedId = normalized.id;
      } catch (error) {
        console.error('Skipping invalid question payload', error);
      }
    });

    if (!added) {
      alert('No valid questions were found in the JSON you provided.');
      return;
    }

    nextQuestions.sort((a, b) => a.id - b.id);
    setQuestions(nextQuestions);

    if (lastAddedId !== null) {
      const targetIndex = nextQuestions.findIndex(q => q.id === lastAddedId);
      if (targetIndex !== -1) {
        setIndex(targetIndex);
      }
    }

    setFlipped(false);
    setDataStatus(`${nextQuestions.length} question${nextQuestions.length === 1 ? '' : 's'} ready (added ${added}).`);
    setShowQuestionModal(false);
  };

  const normalizeQuestionPayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Question payload must be an object.');
    }
    const id = Number(payload.id);
    if (!Number.isFinite(id)) {
      throw new Error('Question is missing a numeric id.');
    }
    const questionText = payload.question ? String(payload.question) : '';
    const explanationText = payload.explanation ? String(payload.explanation) : '';
    const correctLetter = payload.correct ? String(payload.correct).trim() : '';
    const sanitizedChoices = Array.isArray(payload.choices)
      ? payload.choices.map(choice => ({
        letter: choice && choice.letter ? String(choice.letter).trim() : '',
        text: choice && choice.text ? String(choice.text) : ''
      })).filter(choice => choice.letter)
      : [];
    if (!questionText.trim()) {
      throw new Error(`Question ${id} must include question text.`);
    }
    if (!sanitizedChoices.length) {
      throw new Error(`Question ${id} needs at least one answer choice.`);
    }
    if (!correctLetter) {
      throw new Error(`Question ${id} is missing the correct answer letter.`);
    }
    if (!sanitizedChoices.some(choice => choice.letter === correctLetter)) {
      throw new Error(`Question ${id} correct letter does not match any choice.`);
    }
    return {
      ...payload,
      id,
      question: questionText,
      explanation: explanationText,
      correct: correctLetter,
      choices: sanitizedChoices
    };
  };

  const processTextWithBr = (text) => {
    return text.split('\n').map((str, idx) => (
      <span key={idx}>
        {str}
        <br />
      </span>
    ));
  };

  // Renders

  const q = questions.length > 0 ? questions[index] : null;

  return (
    <>
      <header>
        <div className="header-bar">
          <div className="header-title">EA Trainer · Flashcards · Quiz · Notebook</div>
          <div className="top-actions">
            <button id="csvTrigger" onClick={() => fileInputRef.current?.click()}>Import CSV</button>
            <button id="projectTrigger" onClick={() => projectInputRef.current?.click()}>Load Project</button>
            <button id="addQuestionBtn" type="button" onClick={() => setShowQuestionModal(true)}>Add Question</button>
            <button id="exportBtn" onClick={exportProject} disabled={questions.length === 0}>Export Project</button>
          </div>
        </div>
      </header>

      <section className="utilities">
        <div className="file-buttons">
          <button id="languageToggle" type="button" onClick={() => setLanguageMode(prev => prev === 'en' ? 'zh' : 'en')}>
            {languageMode === 'en' ? '中文' : 'English'}
          </button>
          <div className="inline-menu">
            <button onClick={() => setMode('flash')} className={mode === 'flash' ? 'active' : ''}>Flashcards</button>
            <button onClick={() => setMode('quiz')} className={mode === 'quiz' ? 'active' : ''}>Quiz</button>
            <button onClick={() => setMode('notebook')} className={mode === 'notebook' ? 'active' : ''}>Notebook</button>
          </div>
        </div>
        <div className="status-pill" id="dataStatus">{dataStatus}</div>
      </section>

      <section id="flashMode" className={`modeArea ${mode !== 'flash' ? 'hidden' : ''}`}>
        <div className="panel-grid">
          <div className="card-shell">
            <div className="card-head">
              <span>Flashcard</span>
              <span>{questions.length > 0 ? `${index + 1} / ${questions.length}` : '0 / 0'}</span>
            </div>

            <div id="flashcard" onClick={() => { if (questions.length) setFlipped(!flipped); }}>
              <div id="flashInner" className={flipped ? 'flipped' : ''}>
                <div id="flashFront">
                  {questions.length === 0 ? (
                    <p className="flash-question">Import a CSV to begin.</p>
                  ) : (
                    <>
                      <div className="flash-question">{q?.question}</div>
                      <div>
                        {q?.choices.map(c => (
                          <div key={c.letter} className="option-line"><strong>{c.letter}.</strong> {c.text}</div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div id="flashBack">
                  {questions.length > 0 && (
                    <>
                      <div className="answer-pill">Correct: {q?.correct}</div>
                      <p style={{ marginTop: '16px' }}>
                        {processTextWithBr(q?.explanation || '')}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flash-controls">
              <button onClick={() => {
                if (index > 0) { setIndex(index - 1); setFlipped(false); }
              }}>Prev</button>
              <button onClick={() => {
                if (questions.length === 0) return;
                if (index < questions.length - 1) { setIndex(index + 1); } else { setIndex(0); }
                setFlipped(false);
              }}>Next</button>

              <button type="button" onClick={explainWithAI} disabled={explanationLoading} style={{ background: '#8b5cf6', color: 'white' }}>
                {explanationLoading ? "Explaining..." : "Explain (AI)"}
              </button>

              <button className="accent" onClick={() => {
                if (!questions.length) return;
                setNoteText(notes[q.id] || '');
                setShowNoteModal(true);
              }}>Notebook</button>
            </div>
          </div>

          <div className="side-panel">
            <h4>Quick Notebook</h4>
            <div className="note-card__note">
              {questions.length > 0 && notes[q.id] ? (
                <span dangerouslySetInnerHTML={{ __html: notes[q.id].replace(/\n/g, '<br>') }} />
              ) : 'No notes yet.'}
            </div>
            <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid var(--border)' }} />
            <h4>Helpful Tips</h4>
            <p style={{ color: 'var(--muted)' }}>Flip the card or jump into Quiz mode to check your understanding. Use Export to capture your question set and notes for review later.</p>
          </div>
        </div>
      </section>

      <section id="quizMode" className={`modeArea ${mode !== 'quiz' ? 'hidden' : ''}`}>
        <div className="quiz-shell">
          <div className="quiz-head">
            <span>Quiz Mode</span>
            <span>{questions.length > 0 ? `${index + 1} / ${questions.length}` : '0 / 0'}</span>
          </div>

          <div id="quizQuestion">
            {questions.length === 0 ? "Load a CSV to practice." : (
              <div className="flash-question">{q?.question}</div>
            )}
          </div>

          <div id="quizOptions">
            {questions.length > 0 && q?.choices.map(choice => (
              <button key={choice.letter} onClick={(e) => {
                const parent = e.target.parentElement;
                parent.querySelectorAll('button').forEach(b => b.classList.remove('correct', 'incorrect'));
                const isCorrect = choice.letter === q.correct;
                e.target.classList.add(isCorrect ? 'correct' : 'incorrect');

                document.getElementById('quizExplain').innerHTML = `<strong>${isCorrect ? 'Great job!' : 'Review this one:'}</strong> ${q.explanation.replace(/\n/g, '<br>')}`;
              }}>
                {choice.letter}. {choice.text}
              </button>
            ))}
          </div>

          <div id="quizExplain"></div>

          <div className="quiz-controls">
            <button onClick={() => {
              if (index > 0) { setIndex(index - 1); setFlipped(false); }
              document.getElementById('quizExplain').innerHTML = '';
            }}>Prev</button>
            <button onClick={() => {
              if (questions.length === 0) return;
              if (index < questions.length - 1) { setIndex(index + 1); } else { setIndex(0); }
              setFlipped(false);
              document.getElementById('quizExplain').innerHTML = '';
            }}>Next</button>
          </div>
        </div>
      </section>

      <section id="notebookMode" className={`modeArea ${mode !== 'notebook' ? 'hidden' : ''}`}>
        <div className="notes-shell">
          <div className="quiz-head">
            <span>Notebook View</span>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span>{Object.values(notes).filter(t => t && t.trim()).length} Notes</span>
              <button onClick={exportNotesToPDF} style={{ padding: '6px 14px', fontSize: '13px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '999px', cursor: 'pointer' }}>
                Download PDF
              </button>
            </div>
          </div>
          <div id="notebookViewContainer">
            {Object.entries(notes).filter(([, text]) => text && text.trim().length).length === 0 ? (
              <div className="empty-state">No notes yet.</div>
            ) : (
              Object.entries(notes)
                .filter(([, text]) => text && text.trim())
                .map(([id, text]) => {
                  const matchedQ = questions.find(question => question.id === Number(id));
                  const prompt = matchedQ ? matchedQ.question : `Question ${id}`;
                  return (
                    <div key={id} className="note-card">
                      <div className="note-card__title">Question {id}</div>
                      <div className="note-card__question">{prompt}</div>
                      <div className="note-card__note">
                        <span dangerouslySetInnerHTML={{ __html: text.replace(/\n/g, '<br>') }} />
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </section>

      {showNoteModal && (
        <div className="modal show" onClick={(e) => { if (e.target === e.currentTarget) setShowNoteModal(false); }}>
          <div className="modal-content">
            <h3>Notebook — Question {q?.id}</h3>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Capture key reminders, traps, or mnemonics."
            ></textarea>
            <div className="modal-actions">
              <button type="button" onClick={() => setShowNoteModal(false)}>Cancel</button>
              <button type="button" onClick={() => {
                if (!q) return;
                const text = noteText.trim();
                if (text) {
                  setNotes(prev => ({ ...prev, [q.id]: text }));
                } else {
                  setNotes(prev => {
                    const newNotes = { ...prev };
                    delete newNotes[q.id];
                    return newNotes;
                  });
                }
                setShowNoteModal(false);
              }}>Save Note</button>
            </div>
          </div>
        </div>
      )}

      {showQuestionModal && (
        <div className="modal show" onClick={(e) => { if (e.target === e.currentTarget) setShowQuestionModal(false); }}>
          <div className="modal-content">
            <h3>Add Question JSON</h3>
            <p style={{ marginTop: 0, color: 'var(--muted)' }}>Paste a single question object or an array of questions.</p>
            <textarea
              value={questionJsonText}
              onChange={(e) => setQuestionJsonText(e.target.value)}
              placeholder='{"id":101,"question":"..."}'
            ></textarea>
            <div className="modal-actions">
              <button type="button" onClick={() => setShowQuestionModal(false)}>Cancel</button>
              <button type="button" onClick={addQuestionFromModal}>Add Question</button>
            </div>
          </div>
        </div>
      )}

      <input type="file" ref={fileInputRef} accept=".csv" hidden onChange={handleCSVUpload} />
      <input type="file" ref={projectInputRef} accept=".json" hidden onChange={handleProjectUpload} />

      <footer>Built for quick EA refresh sessions.</footer>
    </>
  );
}
