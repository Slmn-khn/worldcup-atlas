// Renders a Fact's content blocks — MUI only, never dangerouslySetInnerHTML.
// Detail pages can hold any number of blocks; an empty or fully-invalid list
// (already filtered by parseContentBlocks) shows a clean fallback instead of
// an empty page. Unrecognized block shapes fall through the switch's default
// and render nothing, so a future block type never crashes older deployments.

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import EmptyState from "@/components/ui/EmptyState";
import Link from "@/components/Link";
import QuizBlock from "./QuizBlock";
import type { FactContentBlock } from "@/server/facts/types";
import {
  nexusBorders,
  nexusColors,
  nexusGradients,
  nexusRadius,
} from "@/theme/visualTokens";

function HeadingBlock({ text }: { text: string }) {
  return (
    <Typography
      variant="h4"
      component="h2"
      sx={{ color: nexusColors.textPrimary, mt: 1, mb: 0.5 }}
    >
      {text}
    </Typography>
  );
}

function ParagraphBlock({ text }: { text: string }) {
  return (
    <Typography variant="body1" sx={{ color: nexusColors.textSecondary }}>
      {text}
    </Typography>
  );
}

function CalloutBlock({
  text,
  variant = "default",
}: {
  text: string;
  variant?: "gold" | "cyan" | "default";
}) {
  const accentColor =
    variant === "gold"
      ? nexusColors.gold
      : variant === "cyan"
        ? nexusColors.cyan
        : nexusColors.textSecondary;
  return (
    <Box
      sx={{
        borderLeft: `3px solid ${accentColor}`,
        bgcolor: nexusColors.surface,
        borderRadius: `${nexusRadius.sm}px`,
        px: 2.5,
        py: 2,
      }}
    >
      <Typography variant="body1" sx={{ color: nexusColors.textPrimary }}>
        {text}
      </Typography>
    </Box>
  );
}

function StatGridBlock({
  items,
}: {
  items: Array<{ label: string; value: string; note?: string }>;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: {
          xs: "1fr 1fr",
          sm: `repeat(${Math.min(items.length, 4)}, minmax(0, 1fr))`,
        },
      }}
    >
      {items.map((item, index) => (
        <Box
          key={`${item.label}-${index}`}
          sx={{
            border: nexusBorders.soft,
            borderRadius: `${nexusRadius.sm}px`,
            bgcolor: nexusColors.surface,
            px: 2,
            py: 1.5,
          }}
        >
          <Typography
            component="p"
            sx={{
              fontFamily: "var(--font-display), system-ui, sans-serif",
              fontWeight: 700,
              fontSize: "1.4rem",
              color: nexusColors.goldStrong,
              lineHeight: 1.1,
            }}
          >
            {item.value}
          </Typography>
          <Typography
            component="p"
            sx={{
              fontSize: "0.68rem",
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: nexusColors.textMuted,
              mt: 0.5,
            }}
          >
            {item.label}
          </Typography>
          {item.note ? (
            <Typography
              variant="caption"
              sx={{ color: nexusColors.textSecondary, display: "block", mt: 0.5 }}
            >
              {item.note}
            </Typography>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

function TimelineBlock({
  items,
}: {
  items: Array<{ year?: number; label: string; description?: string }>;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        borderLeft: nexusBorders.soft,
        pl: 3,
      }}
    >
      {items.map((item, index) => (
        <Box key={`${item.label}-${index}`} sx={{ position: "relative" }}>
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              left: -27,
              top: 4,
              width: 8,
              height: 8,
              borderRadius: "50%",
              bgcolor: nexusColors.cyan,
              boxShadow: `0 0 8px 1px ${nexusColors.cyan}`,
            }}
          />
          {item.year !== undefined ? (
            <Typography
              component="p"
              sx={{
                fontFamily: "var(--font-display), system-ui, sans-serif",
                fontWeight: 700,
                color: nexusColors.cyanStrong,
                fontSize: "0.95rem",
              }}
            >
              {item.year}
            </Typography>
          ) : null}
          <Typography
            component="p"
            sx={{ color: nexusColors.textPrimary, fontWeight: 600 }}
          >
            {item.label}
          </Typography>
          {item.description ? (
            <Typography
              variant="body2"
              sx={{ color: nexusColors.textSecondary, mt: 0.25 }}
            >
              {item.description}
            </Typography>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

function ComparisonBlock({
  title,
  items,
}: {
  title?: string;
  items: Array<{ label: string; value: string; note?: string }>;
}) {
  return (
    <Box
      sx={{
        border: nexusBorders.soft,
        borderRadius: `${nexusRadius.md}px`,
        overflow: "hidden",
      }}
    >
      {title ? (
        <Box sx={{ px: 2.5, py: 1.5, borderBottom: nexusBorders.soft }}>
          <Typography
            component="p"
            sx={{
              fontSize: "0.7rem",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: nexusColors.textSecondary,
            }}
          >
            {title}
          </Typography>
        </Box>
      ) : null}
      {items.map((item, index) => (
        <Box
          key={`${item.label}-${index}`}
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 2,
            px: 2.5,
            py: 1.5,
            borderTop: index === 0 && !title ? undefined : nexusBorders.soft,
          }}
        >
          <Box>
            <Typography variant="body2" sx={{ color: nexusColors.textSecondary }}>
              {item.label}
            </Typography>
            {item.note ? (
              <Typography variant="caption" sx={{ color: nexusColors.textMuted }}>
                {item.note}
              </Typography>
            ) : null}
          </Box>
          <Typography
            component="p"
            sx={{
              fontFamily: "var(--font-display), system-ui, sans-serif",
              fontWeight: 700,
              color: nexusColors.textPrimary,
              whiteSpace: "nowrap",
            }}
          >
            {item.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function RelatedLinksBlock({
  title,
  items,
}: {
  title?: string;
  items: Array<{ label: string; href: string; type?: string }>;
}) {
  return (
    <Box>
      {title ? (
        <Typography
          component="p"
          sx={{
            fontSize: "0.7rem",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: nexusColors.textSecondary,
            mb: 1.5,
          }}
        >
          {title}
        </Typography>
      ) : null}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.25 }}>
        {items.map((item, index) => (
          <Typography
            key={`${item.href}-${index}`}
            component={Link}
            href={item.href}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.75,
              border: nexusBorders.cyan,
              borderRadius: "999px",
              px: 1.75,
              py: 0.75,
              fontSize: "0.78rem",
              fontWeight: 600,
              color: nexusColors.cyanStrong,
              transition: "border-color 150ms ease, color 150ms ease",
              "&:hover": {
                borderColor: nexusColors.cyanStrong,
                color: nexusColors.textPrimary,
              },
            }}
          >
            {item.label} →
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

function SourceNoteBlock({ text }: { text: string }) {
  return (
    <Typography
      variant="caption"
      component="p"
      sx={{ color: nexusColors.textMuted, fontStyle: "italic" }}
    >
      {text}
    </Typography>
  );
}

function renderBlock(block: FactContentBlock, index: number) {
  switch (block.type) {
    case "heading":
      return <HeadingBlock key={index} text={block.text} />;
    case "paragraph":
      return <ParagraphBlock key={index} text={block.text} />;
    case "callout":
      return (
        <CalloutBlock key={index} text={block.text} variant={block.variant} />
      );
    case "stat_grid":
      return <StatGridBlock key={index} items={block.items} />;
    case "timeline":
      return <TimelineBlock key={index} items={block.items} />;
    case "comparison":
      return (
        <ComparisonBlock key={index} title={block.title} items={block.items} />
      );
    case "related_links":
      return (
        <RelatedLinksBlock
          key={index}
          title={block.title}
          items={block.items}
        />
      );
    case "source_note":
      return <SourceNoteBlock key={index} text={block.text} />;
    case "quiz":
      return (
        <QuizBlock
          key={index}
          question={block.question}
          options={block.options}
          correctIndex={block.correctIndex}
          explanation={block.explanation}
        />
      );
    default:
      // Unknown block type — render nothing rather than crash. `parseContentBlocks`
      // already filters these out; this is a second line of defense.
      return null;
  }
}

export default function FactContentRenderer({
  blocks,
}: {
  blocks: FactContentBlock[];
}) {
  if (blocks.length === 0) {
    return (
      <EmptyState
        title="Full story coming soon"
        description="This discovery is being written up in more detail."
      />
    );
  }

  return (
    <Box
      sx={{
        background: nexusGradients.card,
        border: nexusBorders.soft,
        borderRadius: `${nexusRadius.lg}px`,
        px: { xs: 2.5, md: 4 },
        py: { xs: 3, md: 4 },
        display: "flex",
        flexDirection: "column",
        gap: 2.5,
      }}
    >
      {blocks.map((block, index) => renderBlock(block, index))}
    </Box>
  );
}
