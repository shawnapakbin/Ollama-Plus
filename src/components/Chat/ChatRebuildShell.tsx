import Chat, { type ChatProps } from './Chat';
import './ChatRebuildShell.css';

export default function ChatRebuildShell(props: ChatProps) {
  return (
    <section className="chat-rebuild-shell">
      <header className="chat-rebuild-shell-header">
        <h3>Rebuilt Chat UI</h3>
        <p>Experimental shell for phased migration. Core chat pipeline remains unchanged.</p>
      </header>
      <div className="chat-rebuild-shell-body">
        <Chat {...props} uiVariant="rebuild" />
      </div>
    </section>
  );
}
