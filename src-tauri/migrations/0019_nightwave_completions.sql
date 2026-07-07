-- Completed Nightwave acts as reported by the game — the SeasonChallengeHistory
-- section of the same inventory.php blob a game scan already fetches. A
-- rebuildable cache: replaced wholesale on every scan and joined against the
-- live season's acts at read time, so rows from past seasons/acts simply never
-- match anything and need no cleanup.
CREATE TABLE nightwave_completions (
    challenge_path TEXT NOT NULL,  -- '/Lotus/Types/Challenges/Seasons/Daily/…'
    instance_oid   TEXT,           -- act instance id when the game reports one
    recorded_at    TEXT NOT NULL
);
