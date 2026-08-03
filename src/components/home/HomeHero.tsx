// Homepage hero (neon pass). A cinematic deep-blue "stadium at night" panel:
// CSS-only football glow (cyan core + gold counter-glow), faint pitch lines, and
// a vignette — no external image, no FIFA marks. The <h1> carries the title with
// "World Cup" in trophy gold; a glowing search bar and CTAs sit beneath.

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "@/components/Link";
import PageContainer from "@/components/layout/PageContainer";
import NeonButton from "@/components/ui/NeonButton";
import NeonChip from "@/components/ui/NeonChip";
import GlowingSearchBar from "@/components/ui/GlowingSearchBar";
import { atlasColors, atlasGlow, nexusBackgrounds } from "@/theme/visualTokens";

type HomeHeroProps = {
  /** e.g. "1930–2022" — derived from the archive, never hardcoded. */
  span?: string | null;
};

export default function HomeHero({ span }: HomeHeroProps) {
  return (
    <Box
      sx={{
        position: "relative",
        overflow: "hidden",
        // Decorative banner image under a strong dark overlay (heroWithImage);
        // the overlay gradients carry the look if the image is missing.
        backgroundColor: atlasColors.page,
        backgroundImage: nexusBackgrounds.heroWithImage,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        borderBottom: `1px solid ${atlasColors.surfaceRaised}`,
      }}
    >
      {/* Faint pitch lines — CSS only, decorative. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          opacity: 0.5,
          backgroundImage: `
            linear-gradient(transparent 49.5%, ${atlasGlow.cyanSoft} 50%, transparent 50.5%),
            radial-gradient(circle at 50% 120%, ${atlasGlow.cyanSoft}, transparent 45%)`,
          backgroundSize: "100% 64px, 100% 100%",
          maskImage:
            "radial-gradient(120% 90% at 70% 20%, #000 30%, transparent 75%)",
        }}
      />
      {/* Vignette to keep type readable. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          background:
            "radial-gradient(120% 90% at 50% 0%, transparent 40%, rgba(2,8,18,0.7) 100%)",
        }}
      />

      <PageContainer
        sx={{ position: "relative", zIndex: 1, py: { xs: 9, md: 15 } }}
      >
        <Box sx={{ mb: 3 }}>
          <NeonChip
            accent="cyan"
            dot
            label={span != null ? `The Archive · ${span}` : "The Archive"}
          />
        </Box>
        <Typography
          variant="h1"
          sx={{
            fontSize: { xs: "2.9rem", sm: "4rem", md: "5.4rem" },
            maxWidth: 1040,
            mb: 3,
            color: atlasColors.textPrimary,
            textShadow: "0 2px 40px rgba(0,0,0,0.6)",
          }}
        >
          Explore the complete history of the{" "}
          <Box
            component="span"
            sx={{
              color: atlasColors.goldStrong,
              textShadow: `0 0 28px ${atlasGlow.gold}`,
            }}
          >
            World Cup
          </Box>
        </Typography>
        <Typography
          variant="body1"
          sx={{
            color: atlasColors.textSecondary,
            fontSize: { xs: "1rem", md: "1.12rem" },
            maxWidth: 640,
            mb: 5,
          }}
        >
          Every tournament, nation, player, match, goal, and record — from the
          first World Cup to the completed 2026 edition — in one independent
          football archive.
        </Typography>

        <Box sx={{ maxWidth: 680, mb: 4 }}>
          <GlowingSearchBar />
        </Box>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: { xs: "stretch", sm: "center" } }}
        >
          <NeonButton component={Link} href="/tournaments" neon="gold">
            Explore The Archive
          </NeonButton>
          <NeonButton component={Link} href="/records" neon="outline">
            Records
          </NeonButton>
          <Typography
            component={Link}
            href="/schedule/2026"
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.75,
              fontSize: "0.78rem",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: atlasColors.cyanStrong,
              transition: "text-shadow 150ms ease",
              "&:hover": { textShadow: `0 0 16px ${atlasGlow.cyan}` },
            }}
          >
            View 2026 Schedule →
          </Typography>
        </Stack>
      </PageContainer>
    </Box>
  );
}
