import { useState } from "react";
import { toast } from "sonner";
import { putAnnotation, uid } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Write a free-standing note pinned to the reader's current spot. Notes
 * collect on the Annotations page alongside bookmarks and highlights.
 */
export function NoteComposer({
  bookId,
  location,
  label,
  onAdded,
}: {
  bookId: string;
  location: string;
  label: string;
  onAdded: () => void;
}) {
  const [text, setText] = useState("");

  async function save() {
    const content = text.trim();
    if (!content) return;
    await putAnnotation({
      id: uid(),
      bookId,
      type: "note",
      color: "#c9a227",
      text: "",
      note: content,
      location,
      label,
      createdAt: Date.now(),
    });
    setText("");
    onAdded();
    toast.success("Note saved");
  }

  return (
    <div className="mt-4 space-y-2">
      <Textarea
        rows={3}
        placeholder="Write a note about this spot…"
        aria-label="Write a note"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        className="w-full bg-gradient-gold text-xs text-primary-foreground"
        disabled={!text.trim()}
        onClick={() => void save()}
      >
        Save note
      </Button>
    </div>
  );
}
