export const routeFade = (reduced = false) => ({
  initial: { opacity: 0, y: reduced ? 0 : 8 },
  animate: { opacity: 1, y: 0, transition: { duration: reduced ? 0.1 : 0.12 } },
  exit: { opacity: 0, y: reduced ? 0 : -4, transition: { duration: 0.1 } },
});

export const listReveal = (reduced = false) => ({
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: reduced ? 0 : 0.04 } },
});

export const listItem = (reduced = false) => ({
  hidden: { opacity: 0, y: reduced ? 0 : 4 },
  show: { opacity: 1, y: 0, transition: { duration: reduced ? 0.1 : 0.18 } },
});

export const modalSpring = (reduced = false) => ({
  initial: { opacity: 0, scale: reduced ? 1 : 0.98, y: reduced ? 0 : 8 },
  animate: reduced
    ? { opacity: 1, transition: { duration: 0.1 } }
    : { opacity: 1, scale: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 24 } },
  exit: { opacity: 0, scale: reduced ? 1 : 0.98, transition: { duration: 0.12 } },
});

export const rowSettle = (reduced = false) => ({
  initial: { opacity: 0, backgroundColor: "#E4F1EE" },
  animate: { opacity: 1, backgroundColor: "rgba(228,241,238,0)", transition: { duration: reduced ? 0.1 : 0.9 } },
});

export const clockPulse = (reduced = false) => ({
  whileTap: reduced ? {} : { scale: 0.96 },
  transition: { type: "spring", stiffness: 260, damping: 24 },
});
