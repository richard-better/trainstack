/**
 * Shared exercise catalogue — sourced from the Adapted prehab/recovery database.
 * Each exercise includes body regions, category (strength/mobility/stability),
 * unit type (reps_only/seconds_only), load type, equipment, and YouTube IDs.
 *
 * The AI session generator filters by region and selects from this catalogue.
 * sportTags are set to all sports since these are general prehab exercises.
 *
 * Body regions: foot_ankle | knee | hip_groin | low_back | mid_back | shoulder | elbow
 * Categories:   strength | mobility | stability
 */

export interface Exercise {
  id: string;
  name: string;
  /** Step-by-step performance instructions */
  instructions: string;
  /** Clinical rationale — why this exercise is prescribed */
  purpose: string;
  muscleGroup: string;
  movementPattern: string;
  /** Adapted body regions (e.g. ["foot_ankle", "knee"]) */
  regions: string[];
  /** Adapted category: strength | mobility | stability */
  category: string;
  /** "reps_only" or "seconds_only" */
  unitType: string;
  /** "bodyweight_only" | "loaded_only" | "bodyweight_or_loaded" */
  loadType: string;
  /** Required equipment (e.g. ["resistance-band", "bench"]) */
  equipment: string[];
  /** All sports — these are general prehab exercises */
  sportTags: string[];
  youtubeId: string;
  /** S3 key for demo video. Defaults to shared placeholder. */
  videoKey?: string;
}

const ALL_SPORTS = ["running", "cycling", "climbing", "lifting"];

export const PLACEHOLDER_VIDEO_KEY = "exercises/placeholder/demo.mp4";

export function exerciseVideoKey(exercise: Exercise): string {
  return exercise.videoKey ?? `exercises/${exercise.id}/demo.mp4`;
}

export function exerciseThumbnailKey(exerciseId: string): string {
  return `exercises/${exerciseId}/thumbnail.png`;
}

export const exercises: Exercise[] = [
  // ─── ANKLE / FOOT ───────────────────────────────────────────────────

  {
    id: "banded-ankle-dorsiflexion-mobilization",
    name: "Banded Ankle Dorsiflexion Mobilization",
    instructions:
      "Begin standing upright facing a wall or sturdy surface, with a resistance band looped around a fixed anchor point near the floor and around the front of your ankle. Stand far enough from the anchor to create tension in the band.\n\nShift your weight onto your opposite leg and slowly lunge forward with the banded ankle, driving your knee over your toes toward the wall. Hold the end range for 2-3 seconds, then return to the starting position and repeat.\n\nMake sure to keep your heel flat on the floor throughout the movement. Do not allow your arch to collapse inward. The wall or surface is there for balance only — use it lightly.",
    purpose:
      "Addresses ankle dorsiflexion restrictions that commonly develop after sprains or from repetitive loading. Adequate dorsiflexion is essential for proper squat depth, efficient running mechanics, and safe landing from jumps.\n\nImproving mobility here prevents compensation patterns that lead to knee pain and Achilles issues.",
    muscleGroup: "ankle",
    movementPattern: "mobility",
    regions: ["foot_ankle"],
    category: "mobility",
    unitType: "reps_only",
    loadType: "loaded_only",
    equipment: ["resistance-band"],
    sportTags: ALL_SPORTS,
    youtubeId: "nx0reDZMcdE",
  },
  {
    id: "banded-ankle-eversion",
    name: "Banded Ankle Eversion",
    instructions:
      "Begin sitting tall on the ground with one knee bent and the other leg straight with a band looped around the ball of your foot. The band should be anchored near the floor out to the opposite side of your leg.\n\nPull your foot outward against the band. Slowly return to the starting position and repeat.\n\nMake sure to only move at your ankle and try to keep your knee still.",
    purpose:
      "Targets the peroneal muscles on the outside of the lower leg — the primary defense against ankle inversion sprains. Strengthening these muscles builds the reactive strength needed to prevent the most common type of ankle injury.\n\nEssential rehabilitation for anyone with a history of ankle sprains and valuable prevention for sports with quick direction changes.",
    muscleGroup: "ankle",
    movementPattern: "strength",
    regions: ["foot_ankle"],
    category: "strength",
    unitType: "reps_only",
    loadType: "loaded_only",
    equipment: ["resistance-band"],
    sportTags: ALL_SPORTS,
    youtubeId: "QFgPY6oJWcA",
  },
  {
    id: "banded-ankle-inversion",
    name: "Banded Ankle Inversion",
    instructions:
      "Begin sitting tall on the ground with one knee bent and the other leg straight with a band looped around the ball of your foot. The band should be anchored near the floor out to the same side of your leg.\n\nPull your foot inward against the band. Slowly return to the starting position and repeat.\n\nMake sure to only move at your ankle and try to keep your knee still.",
    purpose:
      "Strengthens the tibialis posterior and other muscles that control inward ankle movement, building balanced strength around the ankle joint. These medial stabilizers play a crucial role in foot arch support and overall ankle stability.\n\nHelps prevent excessive foot pronation, supports the medial arch, and reduces injury risk during running and jumping.",
    muscleGroup: "ankle",
    movementPattern: "strength",
    regions: ["foot_ankle"],
    category: "strength",
    unitType: "reps_only",
    loadType: "loaded_only",
    equipment: ["resistance-band"],
    sportTags: ALL_SPORTS,
    youtubeId: "v_zjz5mOvuY",
  },
  {
    id: "double-leg-heel-raise",
    name: "Double-Leg Heel Raise",
    instructions:
      "Begin in a standing upright position with your feet shoulder width apart.\n\nSlowly raise both heels off the ground at the same time, then lower them down to the floor.\n\nMake sure to keep your upper body still and avoid gripping with your toes.",
    purpose:
      "Strengthens the calf muscles essential for walking, running, jumping, and maintaining balance. Strong calves provide the push-off power for efficient gait, absorb forces during landing, and help prevent Achilles tendon injuries and calf strains.\n\nAlso builds ankle stability and proprioception valuable for ankle injury prevention and rehabilitation.",
    muscleGroup: "ankle",
    movementPattern: "strength",
    regions: ["foot_ankle"],
    category: "strength",
    unitType: "reps_only",
    loadType: "bodyweight_or_loaded",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "pNM8Cgm5sbo",
  },
  {
    id: "forward-step-down",
    name: "Forward Step-Down",
    instructions:
      "Begin standing on a step with your hands on your hips.\n\nBalance on one leg and lower your other leg forward off the step to the floor. Lightly touch the floor with your heel then return to the starting position and repeat.\n\nMake sure to maintain your balance during the exercise and do not let your knee collapse inward.",
    purpose:
      "Develops controlled lowering strength essential for safe landing mechanics and deceleration during running and jumping. Challenges the quadriceps, hip stabilizers, and ankle complex to work together, building neuromuscular patterns that prevent knee injuries.\n\nParticularly valuable for addressing quadriceps weakness and patellofemoral pain while teaching proper knee tracking.",
    muscleGroup: "ankle",
    movementPattern: "stability",
    regions: ["foot_ankle", "knee"],
    category: "stability",
    unitType: "reps_only",
    loadType: "bodyweight_or_loaded",
    equipment: ["step"],
    sportTags: ALL_SPORTS,
    youtubeId: "B3CjUyMouBA",
  },
  {
    id: "hip-airplane",
    name: "Hip Airplane",
    instructions:
      "Begin in a standing position with your hands on your hips or at your side.\n\nBalancing on one leg, bend at your hips and slowly tilt your body forward while extending the other leg backward. From this position, rotate your body away from your standing leg, maintaining a forward-bent position. Next, control your body rotation back to the forward-bent position with hips facing the ground. Return to the starting position and repeat.\n\nMake sure to keep your back straight and your standing knee slightly flexed. Don't let your knee collapse inward during the exercise.",
    purpose:
      "Challenges hip stability in multiple planes simultaneously, requiring hip rotators, abductors, and deep stabilizers to work together while standing on one leg. The rotating component builds the reflexive hip stability needed for cutting, pivoting, and maintaining efficient movement mechanics under fatigue.\n\nEffective for addressing hip weakness that contributes to knee pain, IT band syndrome, and lower back issues.",
    muscleGroup: "ankle",
    movementPattern: "stability",
    regions: ["foot_ankle", "knee", "hip_groin"],
    category: "stability",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "2hIL15iGuNA",
  },
  {
    id: "lateral-step-down",
    name: "Lateral Step-Down",
    instructions:
      "Begin standing next to a step or raised surface. Then, step up so that one foot is on the step, and the other is hanging off the edge.\n\nSit back into your hip while leaning slightly forward with your trunk. Continue the squatting movement by bending your knee and hip equally. Tap your heel on the ground without putting weight through the heel. Return to the upright position and repeat. Keep your weight centered on the mid part of your foot throughout the squatting movement by allowing the knee to move forward.\n\nMaintain hip, knee, and foot alignment with the knee over the 2nd toe. Keep your nose in line with your belly button, and do not sidebend towards the exercising leg.",
    purpose:
      "One of the most effective movements for addressing patellofemoral pain and building quadriceps control for safe landing mechanics. The lateral step-down pattern closely mimics descending stairs and landing from jumps.\n\nCorrects movement compensations that lead to anterior knee pain while building the strength necessary for pain-free single-leg activities.",
    muscleGroup: "ankle",
    movementPattern: "stability",
    regions: ["foot_ankle", "knee"],
    category: "stability",
    unitType: "reps_only",
    loadType: "bodyweight_or_loaded",
    equipment: ["step"],
    sportTags: ALL_SPORTS,
    youtubeId: "_r_vsI64pyw",
  },
  {
    id: "single-leg-balance-head-turns",
    name: "Single-Leg Balance with Head Turns",
    instructions:
      "Begin standing upright on firm ground with your feet apart.\n\nLift one leg up and pause in a single leg stance. Once you feel balanced, begin turning your side to side, then up and down. Return to the starting position and repeat with your other leg.\n\nMake sure to perform this exercise next to a wall or near a sturdy surface for safety.",
    purpose:
      "Adds a vestibular challenge to single-leg balance by incorporating head movements, disrupting visual feedback and forcing greater reliance on proprioception. Trains the integration between visual, vestibular, and proprioceptive systems — essential for maintaining balance during dynamic movements.\n\nValuable for improving balance confidence and reducing fall risk in both sport and daily activities.",
    muscleGroup: "ankle",
    movementPattern: "stability",
    regions: ["foot_ankle"],
    category: "stability",
    unitType: "seconds_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "UCj55s-JHXI",
  },
  {
    id: "single-leg-heel-raise",
    name: "Single-Leg Heel Raise",
    instructions:
      "Begin in a standing upright position.\n\nLift one foot off the ground to balance on your other foot. When you are balanced, slowly raise your heel off the ground, then lower it back down and repeat.\n\nMake sure to maintain your balance during the exercise and do not let your ankle rotate to either side.",
    purpose:
      "Builds single-leg ankle plantarflexion strength and exposes left-right imbalances that can contribute to injury. The single-leg demand significantly increases the strength requirements compared to double-leg variations, developing robust calf strength for running, jumping, and explosive push-off.\n\nEssential for Achilles tendon injury prevention and rehabilitation.",
    muscleGroup: "ankle",
    movementPattern: "strength",
    regions: ["foot_ankle"],
    category: "strength",
    unitType: "reps_only",
    loadType: "bodyweight_or_loaded",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "qPd73snQfUs",
  },
  {
    id: "single-leg-rdl-bodyweight",
    name: "Single-Leg RDL",
    instructions:
      "Begin in a standing upright position with your hands resting at your waist.\n\nBalancing on one leg, bend at your hips and slowly tilt your body forward while extending the other leg backward, then return to the starting position and repeat.\n\nMake sure to keep your back straight, and don't let your knee collapse inward during the exercise.",
    purpose:
      "Develops posterior chain strength while simultaneously challenging balance and coordination throughout the kinetic chain. Builds ankle, knee, and hip stability crucial for running, jumping, and change-of-direction, while addressing left-right strength imbalances.\n\nTeaches proper hip hinging mechanics and develops the neuromuscular patterns necessary for safe single-leg loading in sport.",
    muscleGroup: "ankle",
    movementPattern: "stability",
    regions: ["foot_ankle", "knee", "hip_groin"],
    category: "stability",
    unitType: "reps_only",
    loadType: "bodyweight_or_loaded",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "5BwyZ4Bva14",
  },
  {
    id: "soleus-stretch-on-wall",
    name: "Soleus Stretch",
    instructions:
      "Begin in a standing upright position in front of a wall.\n\nPlace your hands on the wall and extend one leg backward with your knee bent. Lean forward into the wall, until you feel a stretch in your lower calf and hold.\n\nMake sure to keep your heels on the ground and back knee bent during the stretch.",
    purpose:
      "Targets the soleus specifically — the deeper calf muscle that crosses only the ankle and is often missed by straight-leg calf stretches. Soleus flexibility is critical for ankle dorsiflexion with a bent knee, which is the actual position during squatting, running, and landing.\n\nAddressing soleus tightness helps prevent Achilles tendon issues and improves squat depth.",
    muscleGroup: "ankle",
    movementPattern: "mobility",
    regions: ["foot_ankle"],
    category: "mobility",
    unitType: "seconds_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "",
  },
  {
    id: "star-excursion-reach",
    name: "Star Excursion Reach",
    instructions:
      "Begin standing on one leg.\n\nReach your free foot out towards different points on the star.\n\nMake sure to keep your movements slow and controlled and do not let your stance knee bend forward past your toes. Try to reach as far as you can while keeping your balance.",
    purpose:
      "Challenges stability and reach in multiple directions from a single-leg stance, building multi-directional control essential for change-of-direction and injury prevention. Develops hip, knee, and ankle coordination needed to maintain control during unpredictable movements.\n\nParticularly valuable for assessing and improving dynamic balance deficits that predispose athletes to lower extremity injuries.",
    muscleGroup: "ankle",
    movementPattern: "stability",
    regions: ["foot_ankle", "knee", "hip_groin"],
    category: "stability",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "UoMSMdMKfBY",
  },
  {
    id: "tibialis-raise-bodyweight",
    name: "Tibialis Raise",
    instructions:
      "Begin in a standing position with your back against a wall for support.\n\nSlowly raise the balls of your feet off the ground as far as you can while keeping your legs straight. Then, return to the starting position and repeat.\n\nMake sure to keep your heels in contact with the ground. Perform the exercise slowly to gain the maximum benefit.",
    purpose:
      "Strengthens the tibialis anterior — the muscle that lifts the front of the foot and controls its lowering during walking and running. Weakness here contributes to shin splints, foot drop during gait, and compensatory movement patterns that increase injury risk.\n\nHelps prevent shin splints and builds the balanced lower leg strength necessary for efficient running mechanics.",
    muscleGroup: "ankle",
    movementPattern: "strength",
    regions: ["foot_ankle"],
    category: "strength",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "VzIcGAgBiaM",
  },
  // ─── KNEE ───────────────────────────────────────────────────────────

  {
    id: "banded-lateral-walks",
    name: "Banded Lateral Walks",
    instructions:
      "Begin standing upright with a resistance band looped around your ankles. Bend your knees slightly so you are in a mini squat position.\n\nSlowly step sideways, maintaining tension in the band.\n\nMake sure to keep your feet pointing straight forward and do not let your knees collapse inward during the exercise.",
    purpose:
      "Targets the hip abductors and external rotators — key stabilizers that prevent the knee from collapsing inward during athletic movements. Effective as both an activation drill before training and as a strengthening exercise for these stabilizers.\n\nCritical for knee injury prevention, improving lateral movement efficiency, and correcting compensation patterns in runners and jumping athletes.",
    muscleGroup: "quadriceps",
    movementPattern: "stability",
    regions: ["hip_groin", "knee"],
    category: "stability",
    unitType: "reps_only",
    loadType: "loaded_only",
    equipment: ["resistance-band"],
    sportTags: ALL_SPORTS,
    youtubeId: "6eoK_yxY8Ak",
  },
  {
    id: "couch-stretch",
    name: "Couch Stretch",
    instructions:
      "Begin in a half kneeling position with your back foot up on a chair behind you and your hips facing forward.\n\nShift your weight forward, pressing your hips forward at the same time. Hold this position. You should feel a stretch on the front of your hip and thigh.\n\nMake sure to stay upright and keep your buttocks tight.",
    purpose:
      "Addresses hip flexor and quadriceps tightness from prolonged sitting and repetitive movement patterns. Improving hip extension range of motion enhances stride length and reduces compensatory stress on the lower back and knees.\n\nParticularly important for runners, cyclists, and anyone spending significant time in hip flexion.",
    muscleGroup: "quadriceps",
    movementPattern: "mobility",
    regions: ["knee", "hip_groin"],
    category: "mobility",
    unitType: "seconds_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "-zoCBsmnF8Y",
  },
  {
    id: "hamstring-bridge-double-leg",
    name: "Hamstring Bridge (Double-Leg)",
    instructions:
      "Begin lying on your back with your knees bent and feet flat on the floor, hip-width apart. Place your arms at your sides with palms facing down.\n\nPress through both heels to lift your hips off the floor, squeezing your glutes and hamstrings until your body forms a straight line from shoulders to knees. Pause briefly at the top, then slowly lower back down. Repeat for the prescribed repetitions.\n\nMake sure to drive through your heels rather than your toes, and avoid overextending at the top by arching your lower back. Keep your core engaged and your chin slightly tucked throughout.",
    purpose:
      "Shifts the bridge emphasis toward the hamstrings by increasing knee flexion demands, building strength through the hamstring's dual role as hip extensor and knee flexor. Addresses the common strength deficits that predispose runners and sprinters to hamstring strains.\n\nValuable for hamstring injury prevention and rehabilitation.",
    muscleGroup: "quadriceps",
    movementPattern: "strength",
    regions: ["knee", "low_back"],
    category: "strength",
    unitType: "reps_only",
    loadType: "bodyweight_or_loaded",
    equipment: ["bench"],
    sportTags: ALL_SPORTS,
    youtubeId: "drr5pv1dQU0",
  },
  {
    id: "hamstring-bridge-single-leg",
    name: "Hamstring Bridge (Single-Leg)",
    instructions:
      "Begin lying on your back with one knee bent and foot flat on the floor, and the opposite leg extended straight out. Place your arms at your sides with palms facing down.\n\nPress through the heel of the bent leg to lift your hips off the floor, keeping the extended leg in line with your body. Squeeze your glutes and hamstrings until your body forms a straight line from shoulder to knee. Pause briefly at the top, then slowly lower back down. Complete the prescribed repetitions on one side before switching.\n\nMake sure to keep your hips level throughout — do not allow the side of the extended leg to drop. Drive through the heel rather than the toes of the working foot.",
    purpose:
      "Maximizes hamstring demands while challenging balance, pelvic stability, and unilateral posterior chain strength. Requires exceptional hamstring strength and control to maintain hip extension while preventing pelvic rotation.\n\nHighly effective for return-to-sport preparation after hamstring injuries, building the eccentric control essential for high-speed running.",
    muscleGroup: "quadriceps",
    movementPattern: "strength",
    regions: ["knee", "low_back"],
    category: "strength",
    unitType: "reps_only",
    loadType: "bodyweight_or_loaded",
    equipment: ["bench"],
    sportTags: ALL_SPORTS,
    youtubeId: "cWiHUKPNYHk",
  },
  {
    id: "seated-quad-stretch",
    name: "Seated Quad Stretch",
    instructions:
      'Sit on the floor in a "Z-sit" position with both knees bent to the same side. Your front shin is perpendicular to your body and your back shin runs alongside your hip.\n\nKeeping your torso upright, slowly lean back onto your hands or forearms. You should feel a stretch in the front of the thigh of your back leg. For a deeper stretch, lower your torso further back toward the floor.\n\nHold for the prescribed duration, then switch sides by rotating your knees to the opposite direction.',
    purpose:
      "Stretches the quadriceps and hip flexors, which are under significant eccentric load during sprinting. Tightness here limits hip extension and contributes to anterior knee pain and hip flexor strain.\n\nParticularly effective post-sprint to counteract the shortening of the rectus femoris from repeated explosive hip flexion.",
    muscleGroup: "quadriceps",
    movementPattern: "mobility",
    regions: ["knee", "hip_groin"],
    category: "mobility",
    unitType: "seconds_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "",
  },
  {
    id: "single-leg-squat-to-box",
    name: "Single-Leg Squat to Box",
    instructions:
      "Begin in a standing upright position in front of a chair.\n\nLift one leg off of the ground and lower yourself into a squatting position, bending at your hips and knees until you lightly touch the chair. Return to a standing position and repeat.\n\nMake sure to maintain your balance during the exercise and do not let your knee bend forward past your toes.",
    purpose:
      "Builds the unilateral strength and control necessary for running, jumping, and landing tasks. The box provides a consistent depth target and safety net for progressive single-leg strength development.\n\nIdentifies and corrects left-right imbalances and builds the eccentric control essential for safe deceleration in sport.",
    muscleGroup: "quadriceps",
    movementPattern: "stability",
    regions: ["knee", "hip_groin"],
    category: "stability",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: ["bench"],
    sportTags: ALL_SPORTS,
    youtubeId: "c6aHletfv9c",
  },
  // ─── HIP / GROIN ────────────────────────────────────────────────────

  {
    id: "copenhagen-plank",
    name: "Copenhagen Plank",
    instructions:
      'Begin lying on your side with your upper foot on top of a chair.\n\nRaise your bottom leg straight up so that both legs are squeezing the chair. Lower down slowly towards the floor and repeat.\n\nMake sure you focus on controlling the "lowering" part of this exercise.',
    purpose:
      "Builds exceptional hip adductor and core strength through an isometric side plank with the top leg elevated. Research has shown this exercise to be highly effective for preventing groin injuries in sports requiring kicking, cutting, and rapid direction changes.\n\nDevelops both adductor strength and endurance while simultaneously challenging lateral core stability.",
    muscleGroup: "hip",
    movementPattern: "strength",
    regions: ["hip_groin"],
    category: "strength",
    unitType: "seconds_only",
    loadType: "bodyweight_only",
    equipment: ["bench"],
    sportTags: ALL_SPORTS,
    youtubeId: "aDsaGBnvDQo",
  },
  {
    id: "cossack-squat",
    name: "Cossack Squat",
    instructions:
      "Begin standing upright with your feet wider than shoulder width apart and toes pointed slightly outward. Hold your hands together at chest height for counterbalance.\n\nShift your weight onto one leg and lower your body down toward that side, bending that knee deeply while keeping the opposite leg straight with the foot flat on the floor. Pause at the bottom, then push through the bent leg to return to the starting position. Alternate sides for the prescribed repetitions.\n\nMake sure to keep your chest up and your bent knee tracking in line with your toes throughout the movement. Do not allow your heel to lift off the floor on the bending side.",
    purpose:
      "Challenges hip, knee, and ankle mobility in the frontal plane — a direction often neglected in traditional training. The deep lateral squat position stretches the adductors and hip internal rotators while building strength through range.\n\nParticularly valuable for athletes in cutting sports to improve lateral movement efficiency and prevent groin strains.",
    muscleGroup: "hip",
    movementPattern: "mobility",
    regions: ["hip_groin"],
    category: "mobility",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "iPZNB5GsOnM",
  },
  {
    id: "figure-four-stretch",
    name: "Figure Four Stretch",
    instructions:
      "Lie on your back with both knees bent and feet flat on the floor. Cross your right ankle over your left knee, forming a figure-four shape. Flex your right foot to protect the knee.\n\nReach your hands around your left thigh (or through the gap between your legs) and gently pull your left knee toward your chest until you feel a stretch in your right glute and hip. Keep your head and shoulders relaxed on the floor.\n\nHold for the prescribed duration, then switch sides.",
    purpose:
      "Targets the piriformis and deep glute rotators using a supine position that allows full relaxation into the stretch. Easier to access for those who find pigeon stretch too intense.\n\nReduces glute and hip tightness that accumulates from sprinting and lateral movement, and helps decompress the lower back by releasing external hip rotator tension.",
    muscleGroup: "hip",
    movementPattern: "mobility",
    regions: ["hip_groin"],
    category: "mobility",
    unitType: "seconds_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "",
  },
  {
    id: "frog-stretch",
    name: "Frog Stretch",
    instructions:
      "Begin on all fours. Slowly walk your knees out wide to each side while keeping your feet in line with your knees, toes pointed outward. Lower your hips back toward your heels as far as comfortable.\n\nRest on your forearms for support and let your hips sink toward the floor. You should feel a stretch along the inner thighs and groin. Avoid forcing the position — let gravity gradually open the hips.\n\nHold for the prescribed duration, breathing deeply and relaxing further into the position with each exhale.",
    purpose:
      "Stretches the hip adductors and groin in a wide, symmetrical position. Adductor tightness is common in sprinters and athletes and contributes to groin strains and restricted hip mobility.\n\nThis stretch allows gravity to do the work, making it effective for passive tissue lengthening with minimal effort.",
    muscleGroup: "hip",
    movementPattern: "mobility",
    regions: ["hip_groin"],
    category: "mobility",
    unitType: "seconds_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "",
  },
  {
    id: "quadruped-rock-back",
    name: "Quadruped Rock-Back",
    instructions:
      "Begin on all fours with your arms directly under your shoulders.\n\nLean your body backward toward your feet, then return to the starting position and repeat.\n\nMake sure to keep your back straight throughout the exercise.",
    purpose:
      "Teaches proper hip hinging mechanics while mobilizing the hips and lower back in a controlled position. The quadruped stance removes balance demands, allowing focus on the movement quality needed for squatting and deadlifting patterns.\n\nHelps differentiate hip movement from lumbar movement — a key skill for preventing lower back injuries under load.",
    muscleGroup: "hip",
    movementPattern: "mobility",
    regions: ["hip_groin", "low_back"],
    category: "mobility",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "aKZGoeHtJ0o",
  },
  {
    id: "side-lying-adduction",
    name: "Side-Lying Adduction",
    instructions:
      "Begin lying on your side with your top leg and hip bent and your bottom leg straight.\n\nLift your bottom leg up toward the ceiling, then slowly lower it back down and repeat.\n\nMake sure to keep your leg straight and do not let your hips roll backward or forward during the exercise.",
    purpose:
      "Isolates the hip adductors in a side-lying position, building inner thigh strength without balance or coordination demands. Effective for groin injury rehabilitation and prevention, strengthening the muscles that contribute to pelvic stability and single-leg balance.\n\nValuable for building the adductor strength needed during kicking and lateral movements.",
    muscleGroup: "hip",
    movementPattern: "strength",
    regions: ["hip_groin"],
    category: "strength",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "lhwT35sshrI",
  },
  {
    id: "banded-adduction",
    name: "Standing Banded Hip Adduction",
    instructions:
      "Begin in a standing upright position balancing on one leg, with a resistance band anchored in a door jam to your side and secured around your ankle that is closest to the anchor point.\n\nSlowly draw your leg inward, creating further tension in the band, then carefully bring your leg back to the starting position.\n\nKeep the knee of your moving leg straight and do not allow your trunk to wobble. Make sure to keep your shoulders and hips level and facing straight forward during the exercise.",
    purpose:
      "Strengthens the hip adductors — inner thigh muscles responsible for bringing the leg toward the midline and providing pelvic stability. Strong adductors are critical for preventing groin strains and maintaining hip alignment during single-leg activities and lateral movements.\n\nParticularly valuable for soccer, hockey, and running athletes prone to adductor injuries.",
    muscleGroup: "hip",
    movementPattern: "strength",
    regions: ["hip_groin"],
    category: "strength",
    unitType: "reps_only",
    loadType: "loaded_only",
    equipment: ["resistance-band"],
    sportTags: ALL_SPORTS,
    youtubeId: "BZKjlZQpx38",
  },
  {
    id: "standing-banded-hip-flexion",
    name: "Standing Banded Hip Flexion",
    instructions:
      "Begin standing upright with a resistance band anchored at a low point behind you, looped around the ankle of the working leg. Stand far enough from the anchor to create tension in the band.\n\nWith a slight bend in the standing knee for balance, drive the working leg forward and upward, lifting your knee toward hip height. Pause briefly at the top, then slowly return to the starting position. Repeat for the prescribed repetitions before switching sides.\n\nMake sure to keep your torso upright throughout — do not lean back to compensate as the leg lifts. Control the return movement; do not let the band pull your leg back quickly.",
    purpose:
      "Strengthens the hip flexors — particularly the iliopsoas — responsible for lifting the knee and driving the leg forward during running and kicking. Strong hip flexors are essential for running speed and maintaining proper mechanics, yet are often undertrained relative to the hip extensors.\n\nBuilds the hip flexion strength necessary for high knee drive during sprinting and improved running efficiency.",
    muscleGroup: "hip",
    movementPattern: "strength",
    regions: ["hip_groin"],
    category: "strength",
    unitType: "reps_only",
    loadType: "loaded_only",
    equipment: ["resistance-band"],
    sportTags: ALL_SPORTS,
    youtubeId: "U7KaLsN3uE8",
  },
  // ─── LOWER BACK / CORE ──────────────────────────────────────────────

  {
    id: "bird-dog",
    name: "Bird Dog",
    instructions:
      "Begin on all fours, with your arms positioned directly under your shoulders.\n\nStraighten one arm and your opposite leg at the same time, until they are parallel to the floor. Hold briefly, then return to the starting position.\n\nMake sure to keep your abdominals tight and hips level during the exercise.",
    purpose:
      "Teaches the spine to resist unwanted movement while the limbs move independently — a foundational skill for injury-resistant athletic movement. Strengthens the deep core stabilizers and improves coordination between opposite limbs.\n\nParticularly valuable for athletes who need to maintain spinal stability during asymmetric loading like throwing, swinging, or carrying.",
    muscleGroup: "core",
    movementPattern: "stability",
    regions: ["low_back"],
    category: "stability",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "k2azbhhuKuM",
  },
  {
    id: "cat-cow",
    name: "Cat-Cow",
    instructions:
      "Begin on all fours with your wrists under your shoulders and knees under your hips. Start in a neutral spine position.\n\nInhale and let your belly drop toward the floor, lifting your tailbone and chest upward (Cow). Then exhale and round your spine toward the ceiling, tucking your chin and pelvis under (Cat). Move fluidly between the two positions.\n\nMove at your own breath pace — this is not a fast exercise. Focus on creating movement through every segment of your spine rather than just the extremes.",
    purpose:
      "Gently mobilizes the entire spine through flexion and extension, reducing stiffness in the thoracic and lumbar regions. Excellent as a warm-up or cooldown to restore spinal movement after loading.\n\nHelps decompress spinal segments and rehydrate intervertebral discs, particularly beneficial after running and impact-based activity.",
    muscleGroup: "core",
    movementPattern: "mobility",
    regions: ["low_back", "mid_back"],
    category: "mobility",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "",
  },
  {
    id: "dead-bug",
    name: "Dead Bug",
    instructions:
      "Begin lying on your back with your knees bent and feet flat on the floor. Engage your abdominals and lift your arms up toward the ceiling.\n\nAt the same time, slowly lower one arm overhead as you straighten your opposite leg. Return to the starting position and repeat with your opposite arm and leg.\n\nMake sure to keep your abdominals engaged during the exercise. Do not let your back arch or your pelvis rotate.",
    purpose:
      "Teaches anti-extension control — the ability to resist unwanted arching of the lower back while moving the limbs. Builds awareness and strength for maintaining a neutral spine, addressing one of the most common causes of lower back pain in athletes.\n\nThe coordinated opposite arm and leg movements improve cross-body coordination essential for running, throwing, and rotational sports.",
    muscleGroup: "core",
    movementPattern: "stability",
    regions: ["low_back"],
    category: "stability",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "GbSC02oU3To",
  },
  {
    id: "glute-bridge-double-leg",
    name: "Glute Bridge (Double-Leg)",
    instructions:
      "Begin lying on your back with your knees bent and heels on the floor.\n\nTighten your buttock muscles, then slowly lift your hips off the ground into a bridge position, concentrating on lifting one vertebra off the ground at a time. Then reverse the movement to lower yourself back down, one vertebra at a time.\n\nMake sure to keep your movements slow and controlled. Keep your abdominals tight as you move into the bridge.",
    purpose:
      "Strengthens the glutes and hamstrings while teaching proper posterior chain activation patterns. Strong glutes are essential for hip extension power, spinal stability, and preventing compensatory stress on the lower back during lifting and running.\n\nHelps counteract the glute inhibition that develops from prolonged sitting, improving hip function and reducing lower back pain.",
    muscleGroup: "core",
    movementPattern: "strength",
    regions: ["low_back"],
    category: "strength",
    unitType: "reps_only",
    loadType: "bodyweight_or_loaded",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "Xp33YgPZgns",
  },
  {
    id: "glute-bridge-single-leg",
    name: "Glute Bridge (Single-Leg)",
    instructions:
      "Begin lying on your back with one knee bent and foot flat on the floor, and the opposite knee bent and lifted to roughly 90 degrees. Place your arms at your sides with palms facing down.\n\nPress through the heel of the grounded foot to lift your hips off the floor, squeezing your glutes at the top until your body forms a straight line from shoulder to knee on the working side. Pause briefly, then slowly lower back down. Complete the prescribed repetitions on one side before switching.\n\nMake sure to keep your hips level — do not let the non-working side drop. Avoid overextending your lower back at the top. The effort should come from your glute on the working side, not your lower back.",
    purpose:
      "Increases the demand on hip extension strength while challenging pelvic stability and exposing left-right imbalances. The single-leg position requires greater glute activation and forces the core and hip stabilizers to prevent pelvic rotation.\n\nParticularly effective for identifying asymmetries that contribute to lower back pain, hip dysfunction, and running injuries.",
    muscleGroup: "core",
    movementPattern: "strength",
    regions: ["low_back"],
    category: "strength",
    unitType: "reps_only",
    loadType: "bodyweight_or_loaded",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "AVAXhy6pl7o",
  },
  {
    id: "side-plank",
    name: "Side Plank",
    instructions:
      "Begin lying on your side with your body in a straight line, elbow directly beneath your shoulder and feet stacked. Lift your hips off the floor until your body forms a straight line from head to feet, supporting yourself on your forearm and the side of your bottom foot.\n\nHold this position for the prescribed duration, then lower and switch sides.\n\nMake sure to keep your hips from sagging toward the floor or rotating forward or backward. Breathe steadily throughout the hold and keep your top arm resting along your side or on your hip.",
    purpose:
      "Develops lateral core strength and stability, targeting the obliques and quadratus lumborum that resist side-bending forces on the spine. Side plank builds the frontal plane stability often neglected in traditional core training but essential for asymmetric loading, carrying, and change-of-direction.\n\nAlso strengthens the hip abductors and improves overall body alignment under fatigue.",
    muscleGroup: "core",
    movementPattern: "stability",
    regions: ["low_back"],
    category: "stability",
    unitType: "seconds_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "",
  },
  {
    id: "supine-spinal-twist",
    name: "Supine Spinal Twist",
    instructions:
      "Lie on your back with both legs extended. Bend your right knee and draw it across your body to the left, using your left hand to gently guide it toward the floor. Extend your right arm out to the side at shoulder height, palm facing up.\n\nTurn your head to the right if comfortable. Let gravity pull your knee toward the floor — avoid forcing it. Keep both shoulders in contact with the floor as much as possible.\n\nHold for the prescribed duration, then switch sides.",
    purpose:
      "Rotates the thoracic and lumbar spine to release tightness accumulated from running and impact activity. Helps restore rotational range of motion and decompress spinal joints.\n\nA calming, restorative stretch that also stretches the glutes and outer hip, making it ideal as a final cooldown exercise.",
    muscleGroup: "core",
    movementPattern: "mobility",
    regions: ["low_back", "mid_back"],
    category: "mobility",
    unitType: "seconds_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "",
  },
  // ─── UPPER BACK / THORACIC ──────────────────────────────────────────

  {
    id: "lat-stretch-on-bench",
    name: "Lat Stretch on Bench",
    instructions:
      "Kneel in front of a bench or box. Place both hands on the edge of the bench shoulder-width apart with palms facing down. Walk your knees back until your arms are fully extended.\n\nDrop your chest toward the floor, letting your head fall between your arms. Push your hips back toward your heels to increase the stretch through your lats and armpits. You should feel a deep stretch along the sides of your torso and into your shoulders.\n\nHold for the prescribed duration. To target one side more, shift your hands slightly to the opposite side.",
    purpose:
      "Lengthens the latissimus dorsi, a large muscle that connects the shoulder to the pelvis and is heavily recruited during sprinting arm drive. Tightness here limits shoulder flexion and thoracic extension.\n\nReleasing the lats post-sprint helps restore overhead mobility and reduces tension transfer into the lower back.",
    muscleGroup: "thoracic_spine",
    movementPattern: "mobility",
    regions: ["mid_back", "shoulder"],
    category: "mobility",
    unitType: "seconds_only",
    loadType: "bodyweight_only",
    equipment: ["bench"],
    sportTags: ALL_SPORTS,
    youtubeId: "",
  },
  {
    id: "open-books-side-lying-thoracic-rotation",
    name: "Open Books Stretch",
    instructions:
      "Begin lying on your side with your legs bent at a 75 degree angle and your arms together straight in front of you on the ground.\n\nSlide your top hand back and forth over your bottom hand 5 times, rotating your shoulders. Then, lift your top arm straight up and over to the floor on your other side.\n\nMake sure to keep your knees together and only rotate your back and upper arm. Your hips should stay facing forward.",
    purpose:
      "Addresses upper back stiffness from desk work, phone use, and sport-specific postures. Thoracic rotation is essential for efficient throwing, swinging, and rotational movements — restrictions here force compensatory stress onto the neck and shoulders.\n\nThe stable hip position isolates mid-back mobility and helps prevent shoulder injuries in overhead athletes.",
    muscleGroup: "thoracic_spine",
    movementPattern: "mobility",
    regions: ["mid_back"],
    category: "mobility",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "OW6YHlxY6JI",
  },
  {
    id: "prone-t",
    name: "Prone T",
    instructions:
      "Begin lying face down with arms resting on the ground straight to your sides.\n\nLift your arms toward the ceiling keeping your elbows straight.\n\nThink of squeezing your shoulder blades together as you lift your arms.",
    purpose:
      "Strengthens the middle trapezius and rhomboids — the scapular retractors that pull the shoulder blades together and down. These muscles are commonly weak from prolonged sitting and forward-focused activities, contributing to rounded shoulders and poor posture.\n\nImproving this pattern enhances scapular stability and builds the upper back strength necessary for overhead movements and pulling.",
    muscleGroup: "thoracic_spine",
    movementPattern: "strength",
    regions: ["shoulder", "mid_back"],
    category: "strength",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "3GJoiYUYwr0",
  },
  {
    id: "prone-y",
    name: "Prone Y",
    instructions:
      "Begin lying on your stomach with your arms overhead in a \\\\\\\\\\\\\\'Y\\\\\\\\\\\\\\\" position and the pinky side of your hands on the foam roller.\n\nPull your shoulder blades together and down towards your hip pockets, rolling the foam roller towards your head. Return to the starting position, rolling the foam roller back overhead.\n\nYou should be feeling the muscles along the inferior angle of your shoulder blades performing the work. Keep your elbows extended and avoid pulling your elbows towards the side of your body.",
    purpose:
      "Targets the lower trapezius and serratus anterior in an overhead Y position, strengthening the scapular upward rotators critical for healthy shoulder elevation. These muscles control scapular upward rotation during arm raising — weakness here contributes to shoulder impingement and rotator cuff injuries.\n\nImproves overhead mechanics and prevents the shoulder dysfunction that occurs when the scapula doesn't move properly.",
    muscleGroup: "thoracic_spine",
    movementPattern: "strength",
    regions: ["shoulder", "mid_back"],
    category: "strength",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "w1AWGKubE5U",
  },
  {
    id: "thoracic-extension-foam-roller",
    name: "Thoracic Extension",
    instructions:
      "Begin lying with your upper back on a foam roll and hands clasped behind your neck.\n\nLet your back relax and head drop toward the floor. Pause briefly, then return to the starting position and repeat.\n\nMake sure not to let your hips rise up off the floor.",
    purpose:
      "Targets thoracic extension — the ability to arch the upper back — which counteracts rounded posture from desk work and phone use. Limited thoracic extension forces the shoulder and neck to compensate during overhead activities, leading to impingement and neck pain.\n\nRestoring mid-back extension improves overhead shoulder mechanics and breathing efficiency.",
    muscleGroup: "thoracic_spine",
    movementPattern: "mobility",
    regions: ["mid_back"],
    category: "mobility",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: ["foam-roller"],
    sportTags: ALL_SPORTS,
    youtubeId: "9Y11Kc0E0og",
  },
  // ─── SHOULDER ───────────────────────────────────────────────────────

  {
    id: "banded-wall-slides",
    name: "Banded Wall Slides",
    instructions:
      "Begin in an upright standing position facing a wall. Place a looped resistance band around your hands with your palms facing inwards with your elbows bent to 90 degrees, then place your forearms against the wall.\n\nSlide your arms up the wall as far as is comfortable while applying gentle pressure. Keep your hands as wide as your elbows. Lower your hands back to the starting position and repeat.\n\nMake sure to keep your back straight and core muscles engaged. Only move your arms as far as you can without causing pain.",
    purpose:
      "Combines shoulder elevation with external rotation resistance, targeting the rotator cuff and scapular stabilizers in a functional overhead pattern. The wall provides feedback for proper movement quality while the band strengthens the muscles responsible for healthy shoulder mechanics.\n\nEffective for addressing shoulder impingement and retraining proper scapulohumeral rhythm for pain-free overhead activities.",
    muscleGroup: "shoulders",
    movementPattern: "strength",
    regions: ["shoulder"],
    category: "strength",
    unitType: "reps_only",
    loadType: "loaded_only",
    equipment: ["resistance-band"],
    sportTags: ALL_SPORTS,
    youtubeId: "C6n7JgS0DeM",
  },
  {
    id: "full-plank-with-shoulder-taps",
    name: "Full Plank with Shoulder Taps",
    instructions:
      "Begin on all fours then straighten your legs to bring yourself into a plank position.\n\nHold this position and lift one hand off the ground to tap your opposite shoulder. Return to starting position and repeat with your other hand.\n\nMake sure to keep your abdominals tight and keep your back straight during the exercise. Do not let your trunk rotate.",
    purpose:
      "Challenges shoulder stability and core anti-rotation strength by removing one point of contact during a plank. Each shoulder tap requires the rotator cuff and serratus anterior to stabilize while the core resists rotational forces.\n\nBuilds the dynamic shoulder stability needed for overhead pressing and any activity requiring the shoulder to stabilize under changing loads.",
    muscleGroup: "shoulders",
    movementPattern: "strength",
    regions: ["shoulder"],
    category: "strength",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "8rgurWd-PB8",
  },
  {
    id: "scapular-push-ups",
    name: "Scapular Push-Ups",
    instructions:
      "Begin on all fours with your arms straight under your shoulders.\n\nRaise your body into a plank position. Slowly round your upper back, pulling your shoulder blades apart. Hold briefly, then lower back down, squeezing your shoulder blades, and repeat.\n\nMake sure to keep your back flat and maintain a gentle chin tuck. Do not shrug your shoulders during the exercise.",
    purpose:
      "Isolates the serratus anterior — the key stabilizer responsible for keeping the shoulder blade properly positioned against the rib cage. Weakness here leads to scapular winging and contributes to shoulder impingement and poor overhead mechanics.\n\nStrengthening this often-neglected muscle improves shoulder blade control and enhances pressing strength.",
    muscleGroup: "shoulders",
    movementPattern: "stability",
    regions: ["shoulder"],
    category: "stability",
    unitType: "reps_only",
    loadType: "bodyweight_only",
    equipment: [],
    sportTags: ALL_SPORTS,
    youtubeId: "NKekqeudgWs",
  },
  {
    id: "suitcase-hold-static",
    name: "Suitcase Hold",
    instructions:
      "Begin standing upright with a kettlebell or dumbbell held at your side in one hand, arm fully extended. Stand tall with your feet hip-width apart.\n\nHold this position for the prescribed duration, keeping the weight steady and your body as upright as possible. Avoid leaning toward or away from the weight. Switch sides as prescribed.\n\nMake sure to resist the urge to hike your shoulder up — keep it packed down away from your ear. Brace your core throughout and breathe steadily.",
    purpose:
      "Develops grip strength and anti-lateral flexion core stability by challenging the body to resist side-bending forces from an asymmetric load. Forces the obliques and quadratus lumborum to work overtime to keep the spine upright.\n\nBuilds functional carrying strength, improves postural control under load, and develops the grip endurance needed for daily activities and sport.",
    muscleGroup: "shoulders",
    movementPattern: "stability",
    regions: ["elbow", "shoulder"],
    category: "stability",
    unitType: "seconds_only",
    loadType: "bodyweight_only",
    equipment: ["dumbbell"],
    sportTags: ALL_SPORTS,
    youtubeId: "cTBmNzZ_IwU",
  },
];

/**
 * Look up an exercise by name (case-insensitive).
 * Used to validate that AI-generated exercise names exist in the catalogue.
 */
export function findExerciseByName(name: string): Exercise | undefined {
  const normalized = name.toLowerCase().trim();
  return exercises.find((ex) => ex.name.toLowerCase() === normalized);
}

export function findExerciseById(id: string): Exercise | undefined {
  return exercises.find((ex) => ex.id === id);
}

/**
 * Maps the user-facing equipment IDs (from the v2 onboarding screen) onto the
 * tags actually used in the catalogue's `equipment` field. The catalogue
 * predates the v2 list and uses singular kebab-case (`resistance-band`,
 * `dumbbell`); the user picks `resistance-bands`, `dumbbells`, etc.
 *
 * Note: `step`, `pull-up-bar`, `kettlebell`, `yoga-mat`, and `massage-ball`
 * aren't currently used by any catalogue exercise — they're listed in the
 * onboarding picker for forward-compat as the catalogue grows.
 */
const EQUIPMENT_USER_TO_CATALOGUE: Record<string, string[]> = {
  "resistance-bands": ["resistance-band"],
  "foam-roller": ["foam-roller"],
  "yoga-mat": [],
  dumbbells: ["dumbbell"],
  kettlebell: [],
  "pull-up-bar": [],
  bench: ["bench"],
  "massage-ball": [],
};

/**
 * Returns exercises that match the selected sports AND whose required equipment
 * is satisfied by the user's gear (or that need no equipment). Empty user
 * equipment → bodyweight-only exercises.
 */
export function getExercisesForSportsAndEquipment(
  sports: string[],
  userEquipment: string[],
): Exercise[] {
  // Translate user-facing equipment IDs into catalogue tags the user effectively owns.
  const ownedCatalogueTags = new Set<string>();
  for (const id of userEquipment) {
    for (const tag of EQUIPMENT_USER_TO_CATALOGUE[id] ?? []) ownedCatalogueTags.add(tag);
  }

  return exercises.filter((ex) => {
    const sportMatch =
      sports.length === 0 ? true : ex.sportTags.some((tag) => sports.includes(tag));
    if (!sportMatch) return false;
    return ex.equipment.every((req) => ownedCatalogueTags.has(req));
  });
}

export function getExerciseNamesForSportsAndEquipment(
  sports: string[],
  userEquipment: string[],
): string[] {
  return getExercisesForSportsAndEquipment(sports, userEquipment).map((ex) => ex.name);
}
