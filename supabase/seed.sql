-- MenuMind Demo seed data.
--
-- Allergen codes follow the EU-14 list. Three rows are deliberately special:
--   * soup-of-the-day        allergens = NULL        (unknown: recipe changes daily)
--   * garlic-bread           allergens incomplete    (no cross-contact data, never reviewed)
--   * quattro-formaggi-pizza available = false       (demonstrates "item unavailable")
-- The assistant must answer "I can't confirm, please check with the kitchen" for
-- the first two, and must refuse to add the third to an order.

insert into public.menu_items (id, name, price, description, available, allergens, ingredients) values

-- Pizza ----------------------------------------------------------------------
('margherita-pizza', 'Margherita Pizza', 12.50,
 'San Marzano tomato, fior di latte mozzarella and fresh basil on a wood-fired base.',
 true,
 '{"contains": ["gluten", "milk"], "may_contain": [], "last_reviewed": "2026-09-01"}',
 array['wheat flour dough', 'San Marzano tomato', 'fior di latte mozzarella', 'basil', 'extra virgin olive oil']),

('pepperoni-pizza', 'Pepperoni Pizza', 14.00,
 'Tomato, mozzarella and spicy pepperoni.',
 true,
 '{"contains": ["gluten", "milk", "mustard"], "may_contain": [], "last_reviewed": "2026-09-01"}',
 array['wheat flour dough', 'tomato', 'mozzarella', 'pepperoni (pork, paprika, mustard seed)']),

('quattro-formaggi-pizza', 'Quattro Formaggi Pizza', 15.50,
 'Mozzarella, gorgonzola, parmigiano and fontina. White base.',
 false,
 '{"contains": ["gluten", "milk"], "may_contain": [], "last_reviewed": "2026-09-01"}',
 array['wheat flour dough', 'mozzarella', 'gorgonzola', 'parmigiano reggiano', 'fontina']),

('pesto-burrata-pizza', 'Pesto Burrata Pizza', 16.00,
 'Basil pesto, creamy burrata and cherry tomatoes.',
 true,
 '{"contains": ["gluten", "milk", "tree_nuts"], "may_contain": [], "last_reviewed": "2026-09-01"}',
 array['wheat flour dough', 'basil pesto (basil, pine nuts, parmigiano, olive oil)', 'burrata', 'cherry tomato']),

-- Pasta ----------------------------------------------------------------------
('spaghetti-carbonara', 'Spaghetti Carbonara', 14.50,
 'Guanciale, egg yolk, pecorino romano and black pepper. No cream.',
 true,
 '{"contains": ["gluten", "eggs", "milk"], "may_contain": [], "last_reviewed": "2026-09-01"}',
 array['durum wheat spaghetti', 'egg yolk', 'guanciale', 'pecorino romano', 'black pepper']),

('penne-arrabbiata', 'Penne Arrabbiata', 12.00,
 'Tomato, garlic and chilli. Vegan.',
 true,
 '{"contains": ["gluten"], "may_contain": ["eggs"], "last_reviewed": "2026-09-01"}',
 array['durum wheat penne', 'tomato', 'garlic', 'chilli', 'extra virgin olive oil', 'parsley']),

('beef-lasagne', 'Beef Lasagne', 15.00,
 'Fresh egg pasta layered with slow-cooked beef ragu and bechamel.',
 true,
 '{"contains": ["gluten", "eggs", "milk", "celery", "sulphites"], "may_contain": [], "last_reviewed": "2026-09-01"}',
 array['fresh egg pasta', 'beef', 'tomato', 'celery', 'carrot', 'onion', 'red wine', 'bechamel (milk, butter, flour)', 'parmigiano reggiano']),

('chicken-pad-thai', 'Chicken Pad Thai', 13.50,
 'Rice noodles wok-fried with chicken, egg, tamarind and roasted peanuts.',
 true,
 '{"contains": ["peanuts", "eggs", "fish"], "may_contain": ["crustaceans", "sesame"], "last_reviewed": "2026-09-01"}',
 array['rice noodles', 'chicken', 'egg', 'tamarind', 'fish sauce', 'bean sprouts', 'roasted peanuts', 'spring onion', 'lime']),

-- Salad ----------------------------------------------------------------------
('caesar-salad', 'Caesar Salad', 11.00,
 'Romaine, sourdough croutons, parmigiano and anchovy Caesar dressing.',
 true,
 '{"contains": ["gluten", "eggs", "fish", "milk", "mustard"], "may_contain": [], "last_reviewed": "2026-09-01"}',
 array['romaine lettuce', 'sourdough croutons', 'parmigiano reggiano', 'Caesar dressing (egg yolk, anchovy, Dijon mustard, lemon)']),

('greek-salad', 'Greek Salad', 10.50,
 'Tomato, cucumber, red onion, kalamata olives and feta.',
 true,
 '{"contains": ["milk"], "may_contain": [], "last_reviewed": "2026-09-01"}',
 array['tomato', 'cucumber', 'red onion', 'kalamata olives', 'feta', 'oregano', 'extra virgin olive oil']),

-- Starters -------------------------------------------------------------------
('garlic-bread', 'Garlic Bread', 5.50,
 'Toasted focaccia with garlic butter and parsley.',
 true,
 '{"contains": ["gluten", "milk"]}',
 array['focaccia', 'butter', 'garlic', 'parsley']),

('soup-of-the-day', 'Soup of the Day', 8.00,
 'Ask your server for today''s soup. Recipe changes daily.',
 true,
 null,
 '{}'),

-- Drinks ---------------------------------------------------------------------
('cola', 'Cola', 3.50,
 '330 ml can.',
 true,
 '{"contains": [], "may_contain": [], "last_reviewed": "2026-09-01"}',
 array['carbonated water', 'sugar', 'caramel colour', 'phosphoric acid', 'natural flavourings', 'caffeine']),

('fresh-lemonade', 'Fresh Lemonade', 4.00,
 'Squeezed to order with mint.',
 true,
 '{"contains": [], "may_contain": [], "last_reviewed": "2026-09-01"}',
 array['lemon', 'sugar', 'water', 'mint']),

-- Desserts -------------------------------------------------------------------
('tiramisu', 'Tiramisu', 7.50,
 'Savoiardi soaked in espresso and marsala, layered with mascarpone cream.',
 true,
 '{"contains": ["gluten", "eggs", "milk", "sulphites"], "may_contain": ["tree_nuts"], "last_reviewed": "2026-09-01"}',
 array['savoiardi (wheat flour, egg, sugar)', 'mascarpone', 'egg', 'sugar', 'espresso', 'marsala wine', 'cocoa']),

('chocolate-brownie', 'Chocolate Brownie', 6.00,
 'Warm dark chocolate brownie.',
 true,
 '{"contains": ["gluten", "eggs", "milk", "soybeans"], "may_contain": ["peanuts", "tree_nuts"], "last_reviewed": "2026-09-01"}',
 array['dark chocolate (soy lecithin)', 'butter', 'sugar', 'egg', 'wheat flour', 'cocoa']);
