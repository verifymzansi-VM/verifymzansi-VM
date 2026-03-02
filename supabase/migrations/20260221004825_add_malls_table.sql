CREATE TABLE public.malls (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    location_province TEXT NOT NULL,
    location_city TEXT,
    cover_photo TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.malls ENABLE ROW LEVEL SECURITY;

-- Allow public read access to malls
CREATE POLICY "Public malls are viewable by everyone."
  ON public.malls FOR SELECT
  USING ( true );

-- Add mall_id foreign key to storefronts
ALTER TABLE public.storefronts
ADD COLUMN mall_id UUID REFERENCES public.malls(id) ON DELETE SET NULL;

-- Create an index to quickly look up shops by mall
CREATE INDEX idx_storefronts_mall_id ON public.storefronts(mall_id);

-- Insert common SA malls
INSERT INTO public.malls (name, location_province, location_city) VALUES
('Sandton City', 'Gauteng', 'Johannesburg'),
('Mall of Africa', 'Gauteng', 'Midrand'),
('Menlyn Park Shopping Centre', 'Gauteng', 'Pretoria'),
('Gateway Theatre of Shopping', 'KwaZulu-Natal', 'Durban'),
('Canal Walk Shopping Centre', 'Western Cape', 'Cape Town'),
('V&A Waterfront', 'Western Cape', 'Cape Town'),
('Rosebank Mall', 'Gauteng', 'Johannesburg'),
('Eastgate Shopping Centre', 'Gauteng', 'Johannesburg'),
('Cresta Shopping Centre', 'Gauteng', 'Johannesburg'),
('The Pavilion Shopping Centre', 'KwaZulu-Natal', 'Durban'),
('Centurion Mall', 'Gauteng', 'Pretoria'),
('Clearwater Mall', 'Gauteng', 'Roodepoort'),
('Fourways Mall', 'Gauteng', 'Johannesburg'),
('Somerset Mall', 'Western Cape', 'Somerset West'),
('Tyger Valley Shopping Centre', 'Western Cape', 'Cape Town'),
('Cavendish Square', 'Western Cape', 'Cape Town'),
('Blue Route Mall', 'Western Cape', 'Cape Town'),
('Walmer Park Shopping Centre', 'Eastern Cape', 'Gqeberha'),
('Greenacres Shopping Centre', 'Eastern Cape', 'Gqeberha'),
('Hemingways Mall', 'Eastern Cape', 'East London'),
('Loch Logan Waterfront', 'Free State', 'Bloemfontein'),
('Mimosa Mall', 'Free State', 'Bloemfontein'),
('Ilanga Mall', 'Mpumalanga', 'Mbombela'),
('Riverside Mall', 'Mpumalanga', 'Mbombela'),
('Highveld Mall', 'Mpumalanga', 'eMalahleni'),
('Savannah Mall', 'Limpopo', 'Polokwane'),
('Mall of the North', 'Limpopo', 'Polokwane'),
('Waterfall Mall', 'North West', 'Rustenburg'),
('MooiRiver Mall', 'North West', 'Potchefstroom'),
('Matlosana Mall', 'North West', 'Klerksdorp'),
('Diamond Pavilion', 'Northern Cape', 'Kimberley'),
('Kalahari Mall', 'Northern Cape', 'Upington');

-- Map existing storefronts to matching malls based on mall_name column (best effort)
UPDATE public.storefronts s
SET mall_id = m.id
FROM public.malls m
WHERE s.mall_name ILIKE m.name || '%' AND s.mall_id IS NULL;
