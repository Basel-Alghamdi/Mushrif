// Shown the moment she opens a conversation, while its code arrives (the same skeleton as ChatView's).
export default function Loading() {
  return (
    <div className="chat">
      <div className="chat-scroll">
        <div className="chat-column">
          <div className="chat-skeleton" aria-label="جارٍ التحميل">
            <i className="skeleton is-user" />
            <i className="skeleton" />
            <i className="skeleton is-short" />
          </div>
        </div>
      </div>
    </div>
  );
}
