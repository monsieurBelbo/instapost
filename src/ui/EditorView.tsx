/** The editor's main area: the stage, which also accepts a dropped image file. */
import { useSignal } from '@preact/signals';
import { loadImageFile } from './editor-state.ts';
import { Stage } from './Stage.tsx';

const hasFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') ?? false;

export function EditorView() {
  const over = useSignal(false);
  return (
    <section
      class={`editor-view${over.value ? ' is-drop-target' : ''}`}
      aria-label="Story canvas; drop an image file here"
      onDragEnter={(e) => {
        if (hasFiles(e)) over.value = true;
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        over.value = true;
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) over.value = false;
      }}
      onDrop={(e) => {
        e.preventDefault();
        over.value = false;
        const file = e.dataTransfer?.files[0];
        if (file) void loadImageFile(file);
      }}
    >
      <Stage />
    </section>
  );
}
