import type { DirectPerson, PresenceStatus } from "@corvo/contracts";
import { PersonAvatar } from "./PersonAvatar";
import { UnreadBadge } from "./UnreadBadge";

/** A person with the counts the server adds to `DirectPerson`; absent from older servers. */
export type PersonRow = DirectPerson & { unreadCount?: number; mentionCount?: number };

/** The other people of the space, each opening the conversation the reader has with them. */
export function PeopleList({
  people,
  activeUserId,
  onOpen,
  presence,
}: {
  people: readonly PersonRow[];
  activeUserId?: string;
  onOpen: (userId: string) => void;
  presence?: ReadonlyMap<string, PresenceStatus>;
}) {
  return (
    <ul data-testid="people-list" className="flex flex-col gap-0.5">
      {people.map((person) => (
        <li key={person.userId}>
          <button
            type="button"
            aria-current={activeUserId === person.userId ? "page" : undefined}
            onClick={() => onOpen(person.userId)}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-start text-nav outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-sidebar-accent"
          >
            <PersonAvatar
              name={person.name}
              image={person.image}
              size={24}
              presence={presence?.get(person.userId)}
              ringClassName="ring-sidebar"
            />
            <span className={`min-w-0 flex-1 truncate ${person.unread ? "font-semibold" : ""}`}>
              {person.name}
            </span>
            <UnreadBadge
              count={person.unreadCount}
              mentions={person.mentionCount}
              unread={person.unread}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}
