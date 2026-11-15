/** What one conversation adds to the total: its count, or one for an unread row that carries none. */
export function unreadMessages(chat: { unread?: boolean; unreadCount?: number }): number {
  if (!chat.unread) return 0;
  return chat.unreadCount && chat.unreadCount > 0 ? chat.unreadCount : 1;
}

export function unreadTotal(chats: readonly { unread?: boolean; unreadCount?: number }[]): number {
  return chats.reduce((sum, chat) => sum + unreadMessages(chat), 0);
}

const COUNT_PREFIX = /^\(\d+\)\s/;

/** The page title with the unread total in front; the plain title at zero. */
export function titleWithUnread(title: string, total: number): string {
  const base = title.replace(COUNT_PREFIX, "");
  return total > 0 ? `(${total}) ${base}` : base;
}
