/**
 * Kept out of package.json so the regex backslashes are plain JS, not JSON escapes.
 *
 * Tests here are deliberately narrow: the pure `*-logic.ts`/`*-algorithm.ts` modules
 * (zero Prisma/Nest imports) get unit tested, thin fetch-then-write service methods do
 * not. Same rule as the prior implementation.
 */
module.exports = {
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: { "^.+\\.ts$": "ts-jest" },
  moduleFileExtensions: ["js", "json", "ts"],
  testEnvironment: "node",
};
