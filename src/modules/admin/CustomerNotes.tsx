// Aba "Notas & Tarefas": o registro do trabalho humano sobre o cliente.
// As notas ficam sob o cliente; as tarefas são top-level (a query dominante é
// "o que vence hoje", que atravessa clientes).

import { useEffect, useState } from 'react';
import type { CrmNote, CrmTask } from '../../types/crm';
import { addNote, addTask, deleteNote, listNotes, listTasks, toggleTask } from '../../services/adminService';
import { Card, EmptyState, ErrorBanner, Spinner, formatDate, formatDateTime } from './ui';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CustomerNotes({ uid, customerName }: { uid: string; customerName: string }) {
  const [notes, setNotes] = useState<CrmNote[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [noteBody, setNoteBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState(today());

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [n, t] = await Promise.all([listNotes(uid), listTasks()]);
      setNotes(n.notes);
      setTasks(t.tasks.filter((task) => task.uid === uid));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  async function submitNote() {
    const body = noteBody.trim();
    if (!body) return;
    setSaving(true);
    try {
      await addNote(uid, body);
      setNoteBody('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeNote(noteId: string) {
    const previous = notes;
    setNotes((list) => list.filter((n) => n.id !== noteId));
    try {
      await deleteNote(uid, noteId);
    } catch (err) {
      setNotes(previous);
      setError((err as Error).message);
    }
  }

  async function submitTask() {
    const title = taskTitle.trim();
    if (!title || !taskDue) return;
    setSaving(true);
    try {
      await addTask({ uid, title, dueDate: taskDue });
      setTaskTitle('');
      setTaskDue(today());
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function flipTask(task: CrmTask) {
    const previous = tasks;
    setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)));
    try {
      await toggleTask(task.id, !task.done);
    } catch (err) {
      setTasks(previous);
      setError((err as Error).message);
    }
  }

  if (loading) return <Spinner />;

  const now = today();

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-700">Tarefas de {customerName}</h2>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Ex.: ligar para entender por que travou no upload"
            className="flex-1 min-w-56 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
          />
          <input
            type="date"
            value={taskDue}
            onChange={(e) => setTaskDue(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
          <button
            onClick={submitTask}
            disabled={saving || !taskTitle.trim()}
            className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-40"
          >
            Criar tarefa
          </button>
        </div>

        {tasks.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">Nenhuma tarefa para este cliente.</p>
        ) : (
          <ul className="mt-4 space-y-1.5">
            {tasks.map((task) => {
              const overdue = !task.done && task.dueDate < now;
              return (
                <li key={task.id} className="flex items-center gap-2.5 py-1">
                  <input
                    type="checkbox"
                    checked={task.done}
                    onChange={() => flipTask(task)}
                    className="accent-violet-600 w-4 h-4"
                  />
                  <span className={`text-sm flex-1 ${task.done ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                    {task.title}
                  </span>
                  <span className={`text-xs ${overdue ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>
                    {formatDate(task.dueDate)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-700">Notas</h2>

        <textarea
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          rows={3}
          placeholder="O que aconteceu nessa conversa?"
          className="mt-3 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
        />
        <button
          onClick={submitNote}
          disabled={saving || !noteBody.trim()}
          className="mt-2 px-3 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900 disabled:opacity-40"
        >
          Adicionar nota
        </button>

        {notes.length === 0 ? (
          <EmptyState title="Nenhuma nota ainda" hint="Registre o que foi conversado para não perder o contexto." />
        ) : (
          <ul className="mt-4 space-y-3">
            {notes.map((note) => (
              <li key={note.id} className="p-3 rounded-lg bg-slate-50 group">
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{note.body}</p>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-400">
                  <span>{note.createdByName}</span>
                  <span>·</span>
                  <span>{formatDateTime(note.createdAt)}</span>
                  <button
                    onClick={() => removeNote(note.id)}
                    className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity font-semibold text-rose-500 hover:text-rose-700"
                  >
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
