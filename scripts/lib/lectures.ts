// Synthetic lecture notes for the seed PDFs. Original text written for this project:
// no real course material. Each page carries one distinctive fact and a search query
// that matches that page and no other (checked by packages/core/test/ingest).

export type CourseKey = "history105" | "biology151" | "statistics240";

export interface LecturePage {
  heading: string;
  /** The distinctive sentence on this page. */
  fact: string;
  /** A search query that should return this page first. */
  query: string;
  body: string[];
}

export interface Lecture {
  file: string;
  courseKey: CourseKey;
  title: string;
  weekLabel: string;
  addedDaysAgo: number;
  pages: LecturePage[];
}

export const LECTURES: Lecture[] = [
  {
    file: "hist105-week1-printing-and-reformation.pdf",
    courseKey: "history105",
    title: "Week 1: Printing and the Reformation",
    weekLabel: "Week 1",
    addedDaysAgo: 20,
    pages: [
      {
        heading: "Why 1450 is our starting line",
        fact: "Johannes Gutenberg finished his printed Bible in Mainz around 1455, using movable metal type.",
        query: "Gutenberg Mainz movable type",
        body: [
          "Before print, a single book could take a scribe many months. Print did not make people literate overnight, but it made copies cheap enough that an argument could travel faster than the authorities chasing it.",
          "Keep one question in mind for the whole unit: who gains when information gets cheaper?",
        ],
      },
      {
        heading: "Luther's challenge",
        fact: "Martin Luther circulated his Ninety-five Theses in Wittenberg in 1517, attacking the sale of indulgences.",
        query: "Ninety-five Theses Wittenberg indulgences",
        body: [
          "Luther wrote in Latin for scholars, but printers translated and reprinted the text within weeks. The dispute moved from a university town to market squares.",
          "Exam tip: explain the role of printers, not only the role of Luther.",
        ],
      },
      {
        heading: "A political settlement",
        fact: "The Peace of Augsburg in 1555 let each German prince choose the religion of his territory, summed up as cuius regio, eius religio.",
        query: "Peace of Augsburg cuius regio",
        body: [
          "The settlement recognised only Catholics and Lutherans. Calvinists were left out, which stored up conflict for the next century.",
          "Notice that the choice belonged to rulers, not to individual believers.",
        ],
      },
      {
        heading: "The Catholic response",
        fact: "The Council of Trent met between 1545 and 1563 and reaffirmed Catholic doctrine while reforming clerical training through seminaries.",
        query: "Council of Trent seminaries",
        body: [
          "Historians call this the Catholic Reformation or the Counter-Reformation, depending on whether they stress renewal or reaction. Be ready to defend either label.",
          "Reading for next week: chapter 2, sections on Atlantic voyages.",
        ],
      },
    ],
  },
  {
    file: "hist105-week2-columbian-exchange.pdf",
    courseKey: "history105",
    title: "Week 2: The Columbian Exchange",
    weekLabel: "Week 2",
    addedDaysAgo: 17,
    pages: [
      {
        heading: "Two hemispheres meet",
        fact: "The historian Alfred Crosby coined the term Columbian Exchange in 1972 to describe the transfer of plants, animals and diseases across the Atlantic.",
        query: "Alfred Crosby coined Columbian Exchange",
        body: [
          "The exchange was biological before it was commercial. Sailors carried organisms they did not know they were carrying.",
          "We will track three flows today: crops, animals and pathogens.",
        ],
      },
      {
        heading: "Crops that changed diets",
        fact: "Potatoes and maize from the Americas raised calorie yields per acre in Europe and China, supporting population growth after 1700.",
        query: "potatoes maize calorie yields",
        body: [
          "In the other direction, sugarcane and wheat moved west. Sugar in particular reorganised land and labour in the Caribbean and Brazil.",
          "Ask of any crop: who planted it, who ate it, and who profited?",
        ],
      },
      {
        heading: "Disease and demographic collapse",
        fact: "Smallpox reached Hispaniola by 1518, and epidemics killed a large share of Indigenous populations within a century of contact.",
        query: "smallpox Hispaniola epidemics",
        body: [
          "Estimates of population loss vary widely because pre-contact counts are uncertain. Present a range and say why it is a range.",
          "Disease weakened societies before and during conquest, but it does not explain conquest by itself.",
        ],
      },
      {
        heading: "Silver ties the world together",
        fact: "The silver mountain of Potosi, in present-day Bolivia, supplied Spanish coins that paid for Chinese silk and porcelain through Manila after 1571.",
        query: "Potosi silver Manila",
        body: [
          "This is the first trade circuit that truly circled the globe. Chinese demand for silver mattered as much as Spanish supply.",
          "Short paper prompt: was the early modern world economy centred on Europe or on Asia?",
        ],
      },
    ],
  },
  {
    file: "hist105-week3-scientific-revolution.pdf",
    courseKey: "history105",
    title: "Week 3: The Scientific Revolution",
    weekLabel: "Week 3",
    addedDaysAgo: 12,
    pages: [
      {
        heading: "A new model of the heavens",
        fact: "Nicolaus Copernicus published On the Revolutions of the Heavenly Spheres in 1543, placing the Sun rather than the Earth at the centre.",
        query: "Copernicus Revolutions Heavenly Spheres",
        body: [
          "The book was technical and read by few. Its importance grew slowly as later observers tested it.",
          "Revolution here means a long change in method, not a single dramatic year.",
        ],
      },
      {
        heading: "Observation with instruments",
        fact: "Galileo Galilei turned a telescope to the sky in 1609 and reported four moons orbiting Jupiter in his Starry Messenger of 1610.",
        query: "Galileo telescope moons Jupiter",
        body: [
          "Moons circling another planet showed that not everything orbits the Earth. Instruments extended the senses and created new kinds of evidence.",
          "His trial in 1633 was about authority as much as astronomy.",
        ],
      },
      {
        heading: "Method",
        fact: "Francis Bacon argued in the Novum Organum of 1620 that knowledge should be built by induction from organised experiment.",
        query: "Francis Bacon Novum Organum induction",
        body: [
          "Compare Bacon with Descartes, who trusted deduction from clear first principles. Working scientists used both.",
          "Learned societies turned private curiosity into shared, checkable results.",
        ],
      },
      {
        heading: "Synthesis",
        fact: "Isaac Newton's Principia of 1687 stated three laws of motion and a law of universal gravitation that covered both falling apples and orbiting planets.",
        query: "Newton Principia universal gravitation",
        body: [
          "One set of mathematical laws for earth and sky was the decisive break with the older picture of the cosmos.",
          "Midterm review: be able to place Copernicus, Galileo, Bacon and Newton in order and say what each added.",
        ],
      },
    ],
  },
  {
    file: "hist105-week4-enlightenment.pdf",
    courseKey: "history105",
    title: "Week 4: The Enlightenment",
    weekLabel: "Week 4",
    addedDaysAgo: 9,
    pages: [
      {
        heading: "Reason applied to society",
        fact: "Immanuel Kant answered the question What is Enlightenment in 1784 with the motto Sapere aude, dare to know.",
        query: "Kant Sapere aude",
        body: [
          "Enlightenment writers borrowed the confidence of the new science and aimed it at law, religion and government.",
          "They disagreed with each other constantly. Treat the Enlightenment as a debate, not a doctrine.",
        ],
      },
      {
        heading: "Government by consent",
        fact: "John Locke's Two Treatises of Government, published in 1689, argued that rulers hold power in trust to protect life, liberty and property.",
        query: "Locke Two Treatises trust property",
        body: [
          "If a ruler breaks that trust, Locke held that the people may replace the government. Later revolutionaries quoted him freely.",
          "Compare with Hobbes, who feared disorder more than tyranny.",
        ],
      },
      {
        heading: "Dividing power",
        fact: "Montesquieu's The Spirit of the Laws in 1748 proposed separating legislative, executive and judicial powers so that each could check the others.",
        query: "Montesquieu Spirit of the Laws separation",
        body: [
          "He admired what he took to be the English system. The idea shaped constitutions written a generation later.",
          "Rousseau took a different road and located sovereignty in the general will of the people.",
        ],
      },
      {
        heading: "Spreading ideas",
        fact: "Denis Diderot and Jean d'Alembert edited the Encyclopedie, whose first volume appeared in Paris in 1751.",
        query: "Diderot d'Alembert Encyclopedie",
        body: [
          "Salons, coffeehouses and cheap pamphlets carried arguments beyond the universities. Censors banned the project more than once and it kept selling.",
          "Reading for next week: the Declaration of the Rights of Man and of the Citizen.",
        ],
      },
    ],
  },
  {
    file: "hist105-week5-french-revolution.pdf",
    courseKey: "history105",
    title: "Week 5: The French Revolution",
    weekLabel: "Week 5",
    addedDaysAgo: 5,
    pages: [
      {
        heading: "From crisis to assembly",
        fact: "The Estates-General met at Versailles in May 1789 for the first time since 1614, called to solve a royal debt crisis.",
        query: "Estates-General Versailles debt crisis",
        body: [
          "Deputies of the Third Estate declared themselves a National Assembly and swore the Tennis Court Oath not to disband until France had a constitution.",
          "Causes to weigh: state finances, bad harvests, and new political language.",
        ],
      },
      {
        heading: "The summer of 1789",
        fact: "Parisians stormed the Bastille on 14 July 1789, and in August the Assembly abolished feudal privileges.",
        query: "stormed Bastille feudal privileges",
        body: [
          "The Declaration of the Rights of Man and of the Citizen followed the same month. It announced equality before the law but left open who counted as an active citizen.",
          "Olympe de Gouges answered in 1791 with a declaration of the rights of woman.",
        ],
      },
      {
        heading: "Radicalisation",
        fact: "The Committee of Public Safety, dominated by Maximilien Robespierre, directed the Terror of 1793 and 1794 until his fall in the month of Thermidor.",
        query: "Committee of Public Safety Robespierre Thermidor",
        body: [
          "War with neighbouring monarchies and revolt in the Vendee pushed the republic toward emergency rule. The king had been executed in January 1793.",
          "Essay question: was the Terror a betrayal of 1789 or its consequence?",
        ],
      },
      {
        heading: "The general takes over",
        fact: "Napoleon Bonaparte seized power in the coup of 18 Brumaire in November 1799 and issued the Civil Code in 1804.",
        query: "Napoleon Brumaire Civil Code",
        body: [
          "The Code kept legal equality for men and secure property while ending elected rule in practice. It travelled with French armies across Europe.",
          "Next week we turn from political revolution to industrial revolution.",
        ],
      },
    ],
  },
  {
    file: "hist105-week6-industrial-revolution.pdf",
    courseKey: "history105",
    title: "Week 6: The Industrial Revolution",
    weekLabel: "Week 6",
    addedDaysAgo: 2,
    pages: [
      {
        heading: "Why Britain first",
        fact: "Abundant coal near navigable water, high wages and cheap energy made labour-saving machines pay in Britain earlier than elsewhere.",
        query: "coal navigable water labour-saving machines",
        body: [
          "No single cause is enough. Combine geography, wages, empire and institutions, and say how they interacted.",
          "Industrialisation was regional: Lancashire changed long before most of the country did.",
        ],
      },
      {
        heading: "Steam",
        fact: "James Watt patented a separate condenser in 1769, which cut the fuel a steam engine burned and made it useful beyond coal mines.",
        query: "James Watt separate condenser",
        body: [
          "Earlier Newcomen engines pumped water out of mines but wasted heat. Efficiency, not invention alone, drove adoption.",
          "Steam later moved from factories to railways and ships.",
        ],
      },
      {
        heading: "Textiles and the factory",
        fact: "Richard Arkwright opened a water-powered cotton spinning mill at Cromford in 1771, an early model of the factory system.",
        query: "Arkwright Cromford spinning mill",
        body: [
          "Factories gathered workers under one roof and one clock. Raw cotton came largely from plantations worked by enslaved people, which links this lecture to week 2.",
          "Hours were long and child labour was common until legislation slowly limited it.",
        ],
      },
      {
        heading: "Resistance and reform",
        fact: "Luddites broke stocking frames and power looms in Nottinghamshire and Yorkshire between 1811 and 1816 to protest falling wages.",
        query: "Luddites stocking frames Nottinghamshire",
        body: [
          "They were skilled workers defending a livelihood, not people afraid of technology. Parliament answered by making machine breaking a capital crime.",
          "Final exam scope: weeks 1 to 6, with emphasis on connections between units.",
        ],
      },
    ],
  },
  {
    file: "bio151-week5-cellular-respiration.pdf",
    courseKey: "biology151",
    title: "Week 5: Cellular Respiration",
    weekLabel: "Week 5",
    addedDaysAgo: 10,
    pages: [
      {
        heading: "Overview",
        fact: "Aerobic respiration yields roughly 30 to 32 ATP per glucose, far more than the 2 ATP from glycolysis alone.",
        query: "aerobic respiration ATP per glucose",
        body: [
          "Respiration releases the energy in glucose in small controlled steps instead of one burst of heat.",
          "Three stages: glycolysis, the citric acid cycle, and oxidative phosphorylation.",
        ],
      },
      {
        heading: "Glycolysis",
        fact: "Glycolysis takes place in the cytosol and splits one glucose into two pyruvate molecules without using oxygen.",
        query: "glycolysis cytosol pyruvate",
        body: [
          "The pathway invests two ATP early and earns four later, for a net gain of two. It also reduces NAD+ to NADH.",
          "Because it needs no oxygen, glycolysis is thought to be very ancient.",
        ],
      },
      {
        heading: "Citric acid cycle",
        fact: "The citric acid cycle, also called the Krebs cycle, runs in the mitochondrial matrix and releases carbon dioxide.",
        query: "Krebs cycle mitochondrial matrix",
        body: [
          "Each turn passes high-energy electrons to NADH and FADH2. Two turns are needed per glucose.",
          "The carbon you breathe out left your food at this stage.",
        ],
      },
      {
        heading: "Oxidative phosphorylation",
        fact: "ATP synthase uses a proton gradient across the inner mitochondrial membrane to make ATP, a process called chemiosmosis.",
        query: "ATP synthase proton gradient chemiosmosis",
        body: [
          "The electron transport chain pumps protons outward and hands electrons to oxygen, forming water.",
          "Lab on Thursday: measuring oxygen use in germinating peas.",
        ],
      },
    ],
  },
  {
    file: "stat240-week6-sampling-distributions.pdf",
    courseKey: "statistics240",
    title: "Week 6: Sampling Distributions",
    weekLabel: "Week 6",
    addedDaysAgo: 4,
    pages: [
      {
        heading: "Statistics vary from sample to sample",
        fact: "A sampling distribution is the distribution of a statistic, such as the sample mean, over all possible samples of the same size.",
        query: "sampling distribution statistic all possible samples",
        body: [
          "A parameter describes a population and is fixed. A statistic describes a sample and changes each time you draw one.",
          "We simulate this in class by drawing many samples from a jar of numbered beads.",
        ],
      },
      {
        heading: "Standard error",
        fact: "The standard error of the mean equals the population standard deviation divided by the square root of the sample size.",
        query: "standard error square root sample size",
        body: [
          "To halve the standard error you need four times as many observations. Precision is expensive.",
          "Do not confuse standard error with standard deviation: one describes estimates, the other describes data.",
        ],
      },
      {
        heading: "Central limit theorem",
        fact: "The central limit theorem says the sample mean is approximately normal for large samples, whatever the shape of the population, with n of at least 30 as a common rule of thumb.",
        query: "central limit theorem approximately normal",
        body: [
          "Strongly skewed populations need larger samples before the approximation is good.",
          "This result is why normal-based methods work so widely.",
        ],
      },
      {
        heading: "Toward inference",
        fact: "A 95 percent confidence interval for a mean is the sample mean plus or minus about 1.96 standard errors.",
        query: "confidence interval 1.96 standard errors",
        body: [
          "The 95 percent describes the method over many samples, not the chance that one computed interval is right.",
          "Homework 6 covers standard error calculations and is due before the next lecture.",
        ],
      },
    ],
  },
];
