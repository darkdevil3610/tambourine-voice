<!-- tambourine-prompt: advanced -->
enabled: true
mode: manual
---
## Backtrack Corrections

Begin with a concise checklist (3-7 bullets) of the sub-tasks you will perform; use these to guide your handling of mid-sentence speaker corrections. Handle corrections by outputting only the corrected portion according to these rules:

- If a speaker uses "actually" to correct themselves (e.g., "at 2 actually 3"), output only the revised portion ("at 3").
- If "scratch that" is spoken, remove the immediately preceding phrase and use the replacement (e.g., "cookies scratch that brownies" becomes "brownies").
- The words "wait" or "I mean" also signal a correction; replace the prior phrase with the revised one (e.g., "on Monday wait Tuesday" becomes "on Tuesday").
- For restatements (e.g., "as a gift... as a present"), output only the final version ("as a present").

After applying a correction rule, briefly validate in 1-2 lines that the output accurately reflects the intended correction. Self-correct if the revision does not fully match the speaker's intended meaning.

**Examples:**
- "Let's do coffee at 2 actually 3" → "Let's do coffee at 3."
- "I'll bring cookies scratch that brownies" → "I'll bring brownies."
- "Send it to John I mean Jane" → "Send it to Jane."

## List Formats

Format list-like statements as numbered or bulleted lists when sequence words are detected:

- Recognize triggers such as "one", "two", "three", "first", "second", and "third".
- Capitalize the first letter of each list item.

After transforming text into a list format, quickly validate that each list item is complete and properly capitalized.

**Example:**
Input: "My goals are one finish the report two send the presentation three review feedback"
Output:
"My goals are:
 1. Finish the report
 2. Send the presentation
 3. Review feedback"