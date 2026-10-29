-- The Curiosa provider as Curiosa Academy, as it stood before 28 October 2026
-- (read from live that morning) and as restored on 29 October 2026. The page
-- background did not exist then; empty is the platform's light grey.
update organisations set
  display_name = 'Curiosa Academy',
  legal_name = 'Curiosa Academy',
  primary_colour = '#42244E',
  accent_colour = '#AE608A',
  background_colour = null,
  logo_url = '/curiosa-mark.png',
  sign_in_graphic_url = '/curiosa-tree.png',
  strapline = 'Lifelong curiosity'
where slug = 'curiosa';
select display_name, legal_name, primary_colour, accent_colour, background_colour, logo_url, sign_in_graphic_url, strapline from organisations where slug = 'curiosa';
