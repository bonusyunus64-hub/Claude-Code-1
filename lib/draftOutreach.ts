import type { GoalType, CampaignTarget } from './campaignTargets';

const DRAFT_TEMPLATES: Record<GoalType, string> = {
  collaborator: `Hi {{targetName}},

I've been following your work as a {{targetSubtitle}} and really admire it. I'm working on a track called "{{songTitle}}" and think there could be a great fit for us to collaborate.

You can hear it here: {{songLink}}

Would you be open to a quick chat about working together?

Best,
{{senderName}}`,
  radio: `Hi {{targetName}} team,

I'm an independent artist with a new track, "{{songTitle}}", that I think would resonate with your listeners.

Listen here: {{songLink}}

I'd love for it to be considered for airplay. Happy to send any extra materials you need.

Thanks for your time,
{{senderName}}`,
  playlist: `Hi {{targetName}},

I wanted to share my new release "{{songTitle}}" with you for consideration on your playlist.

Listen here: {{songLink}}

Thanks so much for considering it — I think it could be a great fit for your audience.

Best,
{{senderName}}`,
  label: `Hi {{targetName}} A&R team,

I'm an independent artist reaching out to share my track "{{songTitle}}", which I think aligns well with what you release.

Listen here: {{songLink}}

I'd welcome the chance to talk further if it's of interest.

Best,
{{senderName}}`,
};

interface DraftVars {
  senderName: string;
  songTitle: string;
  songLink: string;
  target: CampaignTarget;
}

/**
 * BOUNDARY: placeholder template-fill draft generator.
 *
 * Today this just fills a static per-goal template with the sender/song/
 * target details. Swap the body of this function for an AI call (passing
 * the same vars, plus whatever extra context you want) to generate a truly
 * personalised draft per recipient — every caller already treats this as
 * "give me a draft string for this one target," so no caller changes.
 */
export function draftOutreachMessage(goal: GoalType, vars: DraftVars): string {
  const template = DRAFT_TEMPLATES[goal];
  return template
    .replaceAll('{{senderName}}', vars.senderName || 'Your name')
    .replaceAll('{{songTitle}}', vars.songTitle)
    .replaceAll('{{songLink}}', vars.songLink || '[link]')
    .replaceAll('{{targetName}}', vars.target.name)
    .replaceAll('{{targetSubtitle}}', vars.target.subtitle);
}
