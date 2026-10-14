import { Save } from "lucide-react";
import { Button, Modal } from "./ui";

interface Props {
  title: string;
  /** Highlights/drawings exist in StudySpace but haven't been written into the PDF file. */
  annotationsUnsaved: boolean;
  /** Bookmarks were changed in StudySpace but not yet written into the PDF's outline. */
  bookmarksUnsaved: boolean;
  /** A note/resource form has text that hasn't been saved. */
  noteDraft: boolean;
  saving: boolean;
  onSaveAndOpen: () => void;
  onOpenAnyway: () => void;
  onCancel: () => void;
}

/** Asked before leaving a PDF that has unsaved work, when another PDF is opened in the same tab. */
export function UnsavedDialog({ title, annotationsUnsaved, bookmarksUnsaved, noteDraft, saving, onSaveAndOpen, onOpenAnyway, onCancel }: Props) {
  return (
    <Modal
      wide
      title="Unsaved changes"
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Stay here
          </Button>
          <Button variant={noteDraft ? "danger" : "secondary"} onClick={onOpenAnyway} disabled={saving}>
            {noteDraft ? "Discard note and open" : "Open without saving"}
          </Button>
          {(annotationsUnsaved || bookmarksUnsaved) && (
            <Button variant="primary" onClick={onSaveAndOpen} disabled={saving} autoFocus>
              <Save className="size-4" /> {saving ? "Saving…" : "Save to PDF and open"}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm text-ink">
        <span className="font-medium">“{title}”</span> has:
      </p>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-ink-2">
        {annotationsUnsaved && (
          <li>
            <span className="font-medium text-ink">Highlights or drawings not saved into the PDF file.</span> StudySpace keeps them either
            way, and you can save them into the file later. Saving now writes them into the PDF.
          </li>
        )}
        {bookmarksUnsaved && (
          <li>
            <span className="font-medium text-ink">Bookmark changes not saved into the PDF file.</span> StudySpace keeps them either way;
            saving writes them into the PDF's outline, so other PDF readers show them too.
          </li>
        )}
        {noteDraft && (
          <li>
            <span className="font-medium text-ink">A note you're writing that hasn't been saved.</span> Opening another PDF discards it.
            Choose <em>Stay here</em> to finish it first.
          </li>
        )}
      </ul>
    </Modal>
  );
}
