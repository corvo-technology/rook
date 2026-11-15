import { useEffect } from "react";
import { titleWithUnread } from "./unread";

/** Shows the unread total in the document title, and takes it away at zero or on leaving. */
export function useUnreadTitle(total: number) {
  useEffect(() => {
    document.title = titleWithUnread(document.title, total);
    return () => {
      document.title = titleWithUnread(document.title, 0);
    };
  }, [total]);
}
