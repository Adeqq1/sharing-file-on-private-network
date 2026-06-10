"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

export interface Tab {
  title: string;
  icon: LucideIcon;
  type?: never;
}

export interface Separator {
  type: "separator";
  title?: never;
  icon?: never;
}

export type TabItem = Tab | Separator;

export interface ExpandableTabsProps {
  tabs: TabItem[];
  value?: number | null;
  defaultValue?: number | null;
  className?: string;
  activeColor?: string;
  onChange?: (index: number | null) => void;
  ariaLabel?: string;
}

const buttonVariants = {
  initial: {
    gap: 0,
    paddingLeft: ".5rem",
    paddingRight: ".5rem",
  },
  animate: (isSelected: boolean) => ({
    gap: isSelected ? ".5rem" : 0,
    paddingLeft: isSelected ? "1rem" : ".5rem",
    paddingRight: isSelected ? "1rem" : ".5rem",
  }),
};

const spanVariants = {
  initial: { width: 0, opacity: 0 },
  animate: { width: "auto", opacity: 1 },
  exit: { width: 0, opacity: 0 },
};

const transition = { delay: 0.1, type: "spring", bounce: 0, duration: 0.6 } as const;

export function ExpandableTabs({
  tabs,
  value,
  defaultValue = null,
  className,
  activeColor = "text-primary",
  onChange,
  ariaLabel = "Expandable tabs",
}: ExpandableTabsProps) {
  const [internalSelected, setInternalSelected] = React.useState<number | null>(defaultValue);
  const outsideClickRef = React.useRef<HTMLDivElement>(null);
  const selected = value !== undefined ? value : internalSelected;
  const selectableIndexes = tabs.flatMap((tab, index) =>
    tab.type === "separator" ? [] : [index]
  );

  const updateSelected = (index: number | null) => {
    if (value === undefined) {
      setInternalSelected(index);
    }
    onChange?.(index);
  };

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!outsideClickRef.current?.contains(event.target as Node)) {
        updateSelected(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  });

  const handleSelect = (index: number) => {
    updateSelected(index);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const currentPosition = selectableIndexes.indexOf(index);
    let nextPosition: number;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextPosition = (currentPosition + 1) % selectableIndexes.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextPosition =
        (currentPosition - 1 + selectableIndexes.length) % selectableIndexes.length;
    } else if (event.key === "Home") {
      nextPosition = 0;
    } else if (event.key === "End") {
      nextPosition = selectableIndexes.length - 1;
    } else if (event.key === "Escape") {
      event.preventDefault();
      updateSelected(null);
      return;
    } else {
      return;
    }

    event.preventDefault();
    const nextIndex = selectableIndexes[nextPosition];
    updateSelected(nextIndex);
    document.getElementById(`expandable-tab-${nextIndex}`)?.focus();
  };

  const Separator = () => (
    <div className="mx-1 h-[24px] w-[1.2px] bg-border" aria-hidden="true" />
  );

  return (
    <div
      ref={outsideClickRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-2xl border bg-background p-1 shadow-sm",
        className
      )}
    >
      {tabs.map((tab, index) => {
        if (tab.type === "separator") {
          return <Separator key={`separator-${index}`} />;
        }

        const Icon = tab.icon;
        return (
          <motion.button
            id={`expandable-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={selected === index}
            aria-label={tab.title}
            tabIndex={selected === index || (selected === null && index === selectableIndexes[0]) ? 0 : -1}
            key={tab.title}
            variants={buttonVariants}
            initial={false}
            animate="animate"
            custom={selected === index}
            onClick={() => handleSelect(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            transition={transition}
            className={cn(
              "relative flex items-center rounded-xl px-4 py-2 text-sm font-medium transition-colors duration-300",
              selected === index
                ? cn("bg-muted", activeColor)
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon size={20} />
            <AnimatePresence initial={false}>
              {selected === index && (
                <motion.span
                  variants={spanVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={transition}
                  className="overflow-hidden"
                >
                  {tab.title}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        );
      })}
    </div>
  );
}
