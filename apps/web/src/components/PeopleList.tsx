import type { DirectPerson } from "@corvo/contracts";
import { Trans } from "@lingui/react/macro";
import { PersonAvatar } from "./PersonAvatar";

/** The other people of the space, each opening the conversation the reader has with them. */
export function PeopleList({
  people,
  activeUserId,
  onOpen,
}: {
  people: readonly DirectPerson[];
  activeUserId?: string;
  onOpen: (userId: string) => void;
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
            <PersonAvatar name={person.name} image={person.image} size={24} />
            <span className={`min-w-0 flex-1 truncate ${person.unread ? "font-semibold" : ""}`}>
              {person.name}
            </span>
            {person.unread ? (
              <>
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />
                <span className="sr-only">
                  <Trans> (unread)</Trans>
                </span>
              </>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
