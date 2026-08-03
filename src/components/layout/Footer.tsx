import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "@/components/Link";
import VaultStripe from "@/components/vault/VaultStripe";
import { siteConfig } from "@/lib/site";
import { atlas, eyebrowSx } from "@/theme/tokens";

const ARCHIVE_LINKS = siteConfig.navLinks.filter(({ href }) =>
  ["/tournaments", "/matches", "/countries", "/players"].includes(href),
);
const DATA_LINKS = siteConfig.navLinks.filter(({ href }) =>
  ["/records", "/explorer"].includes(href),
);
// Privacy and Media Credits are footer-only (not in the top nav), so they are
// appended here rather than added to siteConfig.navLinks.
const ABOUT_LINKS = [
  ...siteConfig.navLinks.filter(({ href }) =>
    ["/sources", "/about"].includes(href),
  ),
  { label: "Media Credits", href: "/media-credits" },
  { label: "Privacy", href: "/privacy" },
  { label: "Feedback", href: "/feedback" },
];

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: { label: string; href: string }[];
}) {
  return (
    <Box component="nav" aria-label={heading}>
      <Typography
        component="p"
        sx={{ ...eyebrowSx, color: atlas.textMuted, mb: { xs: 1, md: 1.75 } }}
      >
        {heading}
      </Typography>
      <Stack spacing={0.25}>
        {links.map(({ label, href }) => (
          <Typography
            key={href}
            component={Link}
            href={href}
            variant="body2"
            sx={{
              color: atlas.textSecondary,
              // Comfortable touch target (~40px) without stretching the
              // column — links sit on tight rows, not huge single lines.
              display: "inline-flex",
              alignItems: "center",
              minHeight: 40,
              width: "fit-content",
              transition: "color 150ms ease",
              "&:hover": { color: atlas.textPrimary },
            }}
          >
            {label}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
}

export default function Footer() {
  return (
    <Box
      component="footer"
      sx={{
        borderTop: `1px solid ${atlas.border}`,
        bgcolor: atlas.black,
        mt: "auto",
      }}
    >
      <Box
        sx={{
          maxWidth: 1440,
          mx: "auto",
          px: { xs: 2.5, sm: 4, md: 6 },
          // Compact mobile rhythm; roomier desktop. No 96px voids.
          pt: { xs: 5, md: 8 },
          pb: 0,
        }}
      >
        <Box
          sx={{
            display: "grid",
            // Tighter gaps on small screens keep the footer composed.
            columnGap: { xs: 3, sm: 4, md: 6 },
            rowGap: { xs: 4, md: 6 },
            // Mobile + tablet: 2 columns of link groups with the brand
            // spanning the full width. Desktop: brand + 3 columns (4-up).
            gridTemplateColumns: {
              xs: "1fr 1fr",
              md: "minmax(0, 1.6fr) 1fr 1fr 1fr",
            },
          }}
        >
          {/* Brand block — full width below desktop, first column on desktop. */}
          <Box
            sx={{
              gridColumn: { xs: "1 / -1", md: "auto" },
              maxWidth: { xs: "100%", md: 360 },
            }}
          >
            <Typography
              component="p"
              sx={{
                fontFamily: atlas.fontDisplay,
                fontWeight: 700,
                fontSize: "1.3rem",
                letterSpacing: "0.04em",
                color: atlas.textPrimary,
              }}
            >
              {/* Exact brand casing — no text-transform on the wordmark. */}
              WORLDCUP{" "}
              <Box component="span" sx={{ color: atlas.gold }}>
                Nexus
              </Box>
            </Typography>
            <VaultStripe width={56} sx={{ mt: 1, mb: 2 }} />
            <Typography variant="body2" sx={{ color: atlas.textSecondary }}>
              {siteConfig.description}
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: atlas.textMuted, mt: 1.25 }}
            >
              {siteConfig.disclaimer}
            </Typography>
          </Box>
          <FooterColumn heading="Archive" links={ARCHIVE_LINKS} />
          <FooterColumn heading="Data" links={DATA_LINKS} />
          <FooterColumn heading="About" links={ABOUT_LINKS} />
        </Box>

        {/* Bottom attribution row */}
        <Box
          sx={{
            mt: { xs: 4, md: 8 },
            py: { xs: 2.5, md: 3 },
            borderTop: `1px solid ${atlas.border}`,
            display: "flex",
            flexWrap: "wrap",
            gap: 1.5,
            justifyContent: "space-between",
          }}
        >
          <Typography variant="caption" sx={{ color: atlas.textMuted }}>
            Data 1930–2022:{" "}
            <Typography
              component={Link}
              href="/sources"
              variant="caption"
              sx={{
                color: atlas.textSecondary,
                "&:hover": { color: atlas.textPrimary },
              }}
            >
              Fjelstul World Cup Database (CC-BY-SA 4.0)
            </Typography>
            {" · 2026: "}
            <Typography
              component={Link}
              href="/sources"
              variant="caption"
              sx={{
                color: atlas.textSecondary,
                "&:hover": { color: atlas.textPrimary },
              }}
            >
              Mominul FIFA World Cup 2026 Dataset
            </Typography>
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: atlas.textMuted, letterSpacing: "0.08em" }}
          >
            An independent archive · not affiliated with FIFA
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
