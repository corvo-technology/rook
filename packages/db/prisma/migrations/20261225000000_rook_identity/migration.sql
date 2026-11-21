-- The first agent of a space (the Chief) is now called Rook, with the title "Right hand".
-- Data only: the previous release reads the same columns the same way, and an agent that still
-- answers to its old name keeps working. Only an agent that still carries the defaults changes:
-- the name when it is still "Chief" or "Chefe", the description when it is still the default text,
-- the title when the name was the default and no title was set, and the opening of the
-- instructions when the name was the default and the opening is still the default text. An agent
-- the owner renamed or rewrote is left exactly as it is, and a repeat changes nothing.

UPDATE "bots"
SET
  "instructions" = CASE
    WHEN "name" IN ('Chief', 'Chefe') THEN
      replace(
        replace(
          replace(
            replace(
              "instructions",
              'You are the Chief: the owner''s main assistant',
              'You are Rook, the owner''s right hand: their main assistant'
            ),
            '("I am the Chief, organizer of X")',
            '("I am Rook, organizer of X")'
          ),
          'Você é o Chefe: o assistente principal do dono',
          'Você é o Rook, o braço direito do dono: o assistente principal'
        ),
        '("Sou o Chefe, organizador de X")',
        '("Sou o Rook, organizador de X")'
      )
    ELSE "instructions"
  END,
  "title" = CASE
    WHEN "name" IN ('Chief', 'Chefe') AND "title" = '' THEN
      CASE
        WHEN "name" = 'Chefe'
          OR "description" = 'Seu primeiro contato. Diga o que precisa e ele aciona o agente certo.'
          THEN 'Braço direito'
        ELSE 'Right hand'
      END
    ELSE "title"
  END,
  "description" = CASE
    WHEN "description" = 'Your first point of contact. Tell it what you need and it gets the right agent on it.'
      THEN 'Your right hand. Tell it what you need and it gets the right agent on it.'
    WHEN "description" = 'Seu primeiro contato. Diga o que precisa e ele aciona o agente certo.'
      THEN 'Seu braço direito. Diga o que precisa e ele aciona o agente certo.'
    ELSE "description"
  END,
  "name" = CASE WHEN "name" IN ('Chief', 'Chefe') THEN 'Rook' ELSE "name" END
WHERE ("spawnKey" = 'onboarding:first' OR ("spawnKey" IS NULL AND "name" = 'Chief'))
  AND (
    "name" IN ('Chief', 'Chefe')
    OR "description" IN (
      'Your first point of contact. Tell it what you need and it gets the right agent on it.',
      'Seu primeiro contato. Diga o que precisa e ele aciona o agente certo.'
    )
  );
