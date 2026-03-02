-- Rename listing_category enum values to match application TypeScript types.
-- DB had: cars_vehicles, auto_parts_tools, electronics_tech, jobs_other
-- App uses: vehicles, auto_parts, electronics, jobs_services

ALTER TYPE listing_category RENAME VALUE 'cars_vehicles'    TO 'vehicles';
ALTER TYPE listing_category RENAME VALUE 'auto_parts_tools' TO 'auto_parts';
ALTER TYPE listing_category RENAME VALUE 'electronics_tech' TO 'electronics';
ALTER TYPE listing_category RENAME VALUE 'jobs_other'       TO 'jobs_services';
