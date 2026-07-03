"use client";

// Mini quiz block rendered inside a fact's content blocks (see
// FactContentRenderer). One attempt per page view; the answer is scored
// entirely client-side and recorded to localStorage via recordQuizAttempt —
// no network call, no personal data, no account.

import { useState } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";
import { recordQuizAttempt } from "@/lib/discoveryProgress";
import {
  atlasColors,
  nexusBorders,
  nexusColors,
  nexusRadius,
} from "@/theme/visualTokens";

export default function QuizBlock({
  question,
  options,
  correctIndex,
  explanation,
}: {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  function handleSelect(index: number) {
    if (selected !== null) return;
    setSelected(index);
    recordQuizAttempt(index === correctIndex);
  }

  return (
    <Box
      sx={{
        border: nexusBorders.gold,
        borderRadius: `${nexusRadius.md}px`,
        bgcolor: nexusColors.surface,
        px: { xs: 2.5, md: 3 },
        py: { xs: 2.5, md: 3 },
      }}
    >
      <Typography
        component="p"
        sx={{
          fontSize: "0.68rem",
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: nexusColors.goldStrong,
          mb: 1.5,
        }}
      >
        Quick Quiz
      </Typography>
      <Typography
        variant="body1"
        sx={{ color: nexusColors.textPrimary, fontWeight: 600, mb: 2 }}
      >
        {question}
      </Typography>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {options.map((option, index) => {
          const showResult = selected !== null;
          const isCorrectOption = index === correctIndex;
          const isWrongSelection = showResult && selected === index && !isCorrectOption;
          const borderColor = showResult
            ? isCorrectOption
              ? nexusColors.gold
              : isWrongSelection
                ? atlasColors.red
                : nexusBorders.soft
            : nexusBorders.soft;

          return (
            <ButtonBase
              key={index}
              onClick={() => handleSelect(index)}
              disabled={showResult}
              sx={{
                justifyContent: "flex-start",
                textAlign: "left",
                px: 2,
                py: 1.25,
                borderRadius: `${nexusRadius.sm}px`,
                border: `1px solid ${borderColor}`,
                color: nexusColors.textPrimary,
                bgcolor:
                  showResult && isCorrectOption
                    ? "rgba(244,201,93,0.08)"
                    : "transparent",
                transition: "border-color 150ms ease",
                "&:hover": showResult ? undefined : { borderColor: nexusColors.cyan },
                "&.Mui-disabled": { color: nexusColors.textPrimary },
              }}
            >
              {option}
            </ButtonBase>
          );
        })}
      </Box>

      {selected !== null ? (
        <Box sx={{ mt: 2 }}>
          <Typography
            component="p"
            sx={{
              fontWeight: 700,
              color:
                selected === correctIndex ? nexusColors.goldStrong : nexusColors.textSecondary,
            }}
          >
            {selected === correctIndex ? "Correct!" : "Not quite."}
          </Typography>
          {explanation ? (
            <Typography
              variant="body2"
              sx={{ color: nexusColors.textSecondary, mt: 0.5 }}
            >
              {explanation}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
