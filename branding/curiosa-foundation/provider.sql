-- The Curiosa provider as Curiosa Foundation (job sheet D42), as run on live
-- and development on 28 October 2026 and reversed on 29 October 2026, when
-- the Foundation's registration as a provider was delayed. Run it again, on
-- each server, once the Foundation is registered. See README.md.
update organisations set
  display_name = 'Curiosa Foundation',
  legal_name = 'Curiosa Foundation NPC',
  primary_colour = '#0A2B65',
  accent_colour = '#CB876E',
  background_colour = '#FBF3F2',
  logo_url = '/curiosa-mark.png',
  sign_in_graphic_url = '/curiosa-logo.png',
  strapline = 'Recognition · Support · Growth'
where slug = 'curiosa';
select display_name, legal_name, primary_colour, accent_colour, background_colour, logo_url, sign_in_graphic_url, strapline from organisations where slug = 'curiosa';
