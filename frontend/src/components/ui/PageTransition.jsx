import { LazyMotion, domAnimation, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
export function PageTransition({ children, className = '' }) {
  const reducedMotion = useReducedMotion();
  return (
    <LazyMotion features={domAnimation} strict>
      <m.div
        className={className}
        initial={reducedMotion ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.25, ease: 'easeOut' }}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}
