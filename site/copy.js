// The page's only script: Copy buttons for the two extensions addresses, which a web page can't link to.
// Without it the buttons stay hidden and the addresses are plain selectable text.
for (const button of document.querySelectorAll('button[data-copy]')) {
  const [label, name] = [button.textContent, button.ariaLabel];
  button.hidden = false;
  button.setAttribute('aria-live', 'polite');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = button.dataset.done;
    } catch {
      getSelection().selectAllChildren(button.previousElementSibling);
      button.textContent = button.dataset.fail;
      button.dataset.failed = ''; // the longer label moves off the address (style.css)
    }
    button.ariaLabel = button.textContent; // the name follows the state
    setTimeout(() => {
      button.textContent = label;
      button.ariaLabel = name;
      delete button.dataset.failed;
    }, 2000);
  });
}
