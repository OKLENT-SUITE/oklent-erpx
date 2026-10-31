-- Fleet operations: vehicle register, trips, fuel and maintenance history.
CREATE SEQUENCE IF NOT EXISTS fleet_trip_no_seq;

CREATE TABLE IF NOT EXISTS fleet_vehicles (
  id bigserial PRIMARY KEY,
  plate_no text NOT NULL UNIQUE CHECK (length(trim(plate_no)) BETWEEN 2 AND 20),
  vin text UNIQUE CHECK (vin IS NULL OR length(trim(vin)) BETWEEN 5 AND 40),
  make text NOT NULL,
  model text NOT NULL,
  model_year int CHECK (model_year IS NULL OR model_year BETWEEN 1950 AND 2100),
  vehicle_type text NOT NULL DEFAULT 'car' CHECK (vehicle_type IN ('car','van','truck','bus','motorcycle','equipment','other')),
  ownership text NOT NULL DEFAULT 'owned' CHECK (ownership IN ('owned','leased','rented')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','in_service','inactive','sold')),
  branch_id bigint REFERENCES branches(id),
  employee_id bigint REFERENCES employees(id),
  registration_expiry date,
  insurance_expiry date,
  inspection_due date,
  odometer numeric(12,1) NOT NULL DEFAULT 0 CHECK (odometer >= 0),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fleet_vehicles_status_idx ON fleet_vehicles(status, branch_id);

CREATE TABLE IF NOT EXISTS fleet_trips (
  id bigserial PRIMARY KEY,
  trip_no text NOT NULL UNIQUE DEFAULT ('FTR-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('fleet_trip_no_seq')::text,6,'0')),
  vehicle_id bigint NOT NULL REFERENCES fleet_vehicles(id),
  driver_id bigint REFERENCES employees(id),
  trip_date date NOT NULL DEFAULT current_date,
  origin text NOT NULL,
  destination text NOT NULL,
  purpose text NOT NULL,
  start_odometer numeric(12,1) NOT NULL CHECK (start_odometer >= 0),
  end_odometer numeric(12,1) CHECK (end_odometer IS NULL OR end_odometer >= start_odometer),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('planned','completed','cancelled')),
  notes text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT current_user,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fleet_trips_date_idx ON fleet_trips(trip_date, vehicle_id);

CREATE TABLE IF NOT EXISTS fleet_fuel (
  id bigserial PRIMARY KEY,
  vehicle_id bigint NOT NULL REFERENCES fleet_vehicles(id),
  fuel_date date NOT NULL DEFAULT current_date,
  fuel_type text NOT NULL DEFAULT 'petrol' CHECK (fuel_type IN ('petrol','diesel','electric','other')),
  liters numeric(12,2) NOT NULL CHECK (liters > 0),
  unit_price numeric(12,4) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  odometer numeric(12,1) CHECK (odometer IS NULL OR odometer >= 0),
  vendor text NOT NULL DEFAULT '',
  reference text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT current_user,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fleet_fuel_date_idx ON fleet_fuel(fuel_date, vehicle_id);

CREATE TABLE IF NOT EXISTS fleet_maintenance (
  id bigserial PRIMARY KEY,
  vehicle_id bigint NOT NULL REFERENCES fleet_vehicles(id),
  maintenance_date date NOT NULL DEFAULT current_date,
  maintenance_type text NOT NULL CHECK (maintenance_type IN ('scheduled','repair','inspection','tires','other')),
  vendor text NOT NULL DEFAULT '',
  odometer numeric(12,1) CHECK (odometer IS NULL OR odometer >= 0),
  description text NOT NULL,
  cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  next_due_date date,
  reference text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT current_user,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fleet_maintenance_date_idx ON fleet_maintenance(maintenance_date, vehicle_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON fleet_vehicles, fleet_trips, fleet_fuel, fleet_maintenance TO erpx_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erpx_app;
INSERT INTO app_settings(key, value, updated_by, updated_at)
VALUES ('schema', '{"version": "0.11.0"}'::jsonb, 'migration', now())
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at;

-- Keep the master odometer current when a trip or service entry carries a reading.
CREATE OR REPLACE FUNCTION fleet_sync_odometer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE vehicle_key bigint; reading numeric;
BEGIN
  vehicle_key := NEW.vehicle_id;
  IF TG_TABLE_NAME = 'fleet_trips' THEN reading := NEW.end_odometer;
  ELSE reading := NEW.odometer;
  END IF;
  IF reading IS NOT NULL THEN
    UPDATE fleet_vehicles SET odometer=GREATEST(odometer,reading),updated_at=now() WHERE id=vehicle_key;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fleet_trip_odometer ON fleet_trips;
CREATE TRIGGER fleet_trip_odometer AFTER INSERT OR UPDATE ON fleet_trips FOR EACH ROW WHEN (NEW.status='completed') EXECUTE FUNCTION fleet_sync_odometer();
DROP TRIGGER IF EXISTS fleet_fuel_odometer ON fleet_fuel;
CREATE TRIGGER fleet_fuel_odometer AFTER INSERT ON fleet_fuel FOR EACH ROW EXECUTE FUNCTION fleet_sync_odometer();
DROP TRIGGER IF EXISTS fleet_maintenance_odometer ON fleet_maintenance;
CREATE TRIGGER fleet_maintenance_odometer AFTER INSERT ON fleet_maintenance FOR EACH ROW EXECUTE FUNCTION fleet_sync_odometer();
