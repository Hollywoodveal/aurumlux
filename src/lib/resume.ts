import { getBook, getSetting, setSetting } from "@/lib/db";

export type LastRead = { bookId: string; at: number };

const LAST_READ_KEY = "lastRead";
const RESUME_KEY = "resumeOnLaunch";
/** Marks that this app launch already handled (or declined) an auto-resume. */
const LAUNCH_FLAG = "aurum:resumed";

export async function rememberLastRead(bookId: string) {
  await setSetting(LAST_READ_KEY, { bookId, at: Date.now() } satisfies LastRead);
}

export async function getLastRead(): Promise<LastRead | null> {
  return (await getSetting<LastRead | null>(LAST_READ_KEY, null)) ?? null;
}

export async function clearLastRead() {
  await setSetting(LAST_READ_KEY, null);
}

export async function getResumeOnLaunch() {
  return getSetting<boolean>(RESUME_KEY, true);
}

export async function setResumeOnLaunch(on: boolean) {
  await setSetting(RESUME_KEY, on);
}

function launchHandled() {
  try {
    return sessionStorage.getItem(LAUNCH_FLAG) === "1";
  } catch {
    return true;
  }
}

function markLaunchHandled() {
  try {
    sessionStorage.setItem(LAUNCH_FLAG, "1");
  } catch {
    /* private mode — resume simply won't repeat */
  }
}

/**
 * Resolves the book to reopen when the app is launched fresh, or null when the
 * library should be shown. Only ever returns a book once per app launch.
 */
export async function resolveLaunchResume(): Promise<string | null> {
  if (typeof window === "undefined" || launchHandled()) return null;
  markLaunchHandled();
  if (!(await getResumeOnLaunch())) return null;
  const last = await getLastRead();
  if (!last?.bookId) return null;
  const book = await getBook(last.bookId);
  if (!book) return null;
  return book.id;
}
