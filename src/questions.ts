export type ConflictStyle =
  | 'Competing'
  | 'Accommodating'
  | 'Avoiding'
  | 'Compromising'
  | 'Collaborating'

export type Question = {
  id: number
  title: string
  scenario: string
  prompt: string
  correctAnswer: ConflictStyle
  explanation: string
  final?: boolean
}

export const TOTAL_TIME = 50
export const BASE_SCORE = 100
export const MAX_SPEED_BONUS = 50

export const styles: ConflictStyle[] = [
  'Competing',
  'Accommodating',
  'Avoiding',
  'Compromising',
  'Collaborating',
]

export const styleMeta: Record<
  ConflictStyle,
  { icon: string; short: string; color: string; description: string }
> = {
  Competing: {
    icon: 'Zap',
    short: 'Push to win',
    color: '#ff4d6d',
    description: 'You strongly push for your preferred solution.',
  },
  Accommodating: {
    icon: 'HeartHandshake',
    short: 'Yield for harmony',
    color: '#ff9f1c',
    description: "You give priority to the other person's wishes or needs.",
  },
  Avoiding: {
    icon: 'CloudFog',
    short: 'Delay the clash',
    color: '#3a86ff',
    description: 'You choose not to address the conflict immediately.',
  },
  Compromising: {
    icon: 'Scale',
    short: 'Meet halfway',
    color: '#f7d046',
    description: 'Both sides give up something to reach a middle ground.',
  },
  Collaborating: {
    icon: 'UsersRound',
    short: 'Solve together',
    color: '#40f99b',
    description:
      "Both sides openly work toward a solution that meets everyone's important needs.",
  },
}

export const questions: Question[] = [
  {
    id: 1,
    title: 'Project Deadline',
    scenario:
      'Your team has an important project due tomorrow. One member has not finished their assigned section. Instead of confronting them, you quietly take over the work because preserving the relationship feels more important than insisting on your own workload.',
    prompt: 'Which conflict-management style is being demonstrated?',
    correctAnswer: 'Accommodating',
    explanation:
      "You prioritized the relationship and the other person's needs over your own preference.",
  },
  {
    id: 2,
    title: 'Budget Meeting',
    scenario:
      'Two department leads want the same limited training budget. One lead insists their plan must be funded exactly as proposed and keeps pressing the director to approve it, even though the other department will receive nothing.',
    prompt: 'Which style best matches this behavior?',
    correctAnswer: 'Competing',
    explanation:
      'The person is pushing strongly for their preferred outcome with little adjustment.',
  },
  {
    id: 3,
    title: 'Intern Schedule',
    scenario:
      'Two interns disagree about who should cover a Friday shift. Their supervisor senses the conversation is getting tense and says they will return to the topic next week after finals, even though the schedule remains unresolved.',
    prompt: 'Which conflict-management style is being demonstrated?',
    correctAnswer: 'Avoiding',
    explanation:
      'The conflict is being postponed instead of addressed directly right now.',
  },
  {
    id: 4,
    title: 'Campaign Plan',
    scenario:
      'A student organization is split between a social media campaign and a campus booth. After discussion, they agree to run a smaller booth and a shorter online campaign so both ideas receive partial support.',
    prompt: 'Which style best describes the agreement?',
    correctAnswer: 'Compromising',
    explanation:
      'Both sides accepted partial wins and gave something up to reach the middle.',
  },
  {
    id: 5,
    title: 'Client Presentation',
    scenario:
      'A designer wants more visuals in a client deck, while an analyst wants more data. They compare what the client needs, redesign the story, and create slides where the visuals explain the most important evidence.',
    prompt: 'Which conflict-management style is being demonstrated?',
    correctAnswer: 'Collaborating',
    explanation:
      "They worked together to satisfy the important needs behind both positions.",
  },
  {
    id: 6,
    title: 'Office Noise',
    scenario:
      'A teammate repeatedly takes loud calls near a shared study area. You are annoyed, but you say nothing because you do not want the conversation to become awkward before the group presentation.',
    prompt: 'Which style is most likely being used?',
    correctAnswer: 'Avoiding',
    explanation:
      'You are sidestepping the conflict instead of addressing the noise issue.',
  },
  {
    id: 7,
    title: 'Hiring Shortlist',
    scenario:
      'Two managers disagree over a finalist. One values technical skill, the other values client communication. They decide to hire the technical candidate but add communication coaching, while the other manager gives up their preferred choice.',
    prompt: 'Which style is this closest to?',
    correctAnswer: 'Compromising',
    explanation:
      'The solution partially satisfies both sides, but each side gives up something.',
  },
  {
    id: 8,
    title: 'Final Conflict',
    scenario:
      "Our major is creating an official major shirt. One student wants a modern minimalist design. Another wants the university logo to be prominent. Another wants the design to be inexpensive to produce. Instead of choosing one person's preference, the team discusses everyone's important requirements and creates a solution that incorporates the important needs of all sides.",
    prompt: 'Which conflict-management style is being demonstrated?',
    correctAnswer: 'Collaborating',
    explanation:
      "The group integrates everyone's key requirements instead of choosing a single winner.",
    final: true,
  },
]

export function calculateScore(isCorrect: boolean, remainingTime: number) {
  if (!isCorrect) return 0
  return Math.round(BASE_SCORE + (Math.max(0, remainingTime) / TOTAL_TIME) * MAX_SPEED_BONUS)
}
