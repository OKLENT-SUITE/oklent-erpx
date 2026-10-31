-- HR settings catalogs and employee reporting hierarchy.
CREATE TABLE IF NOT EXISTS hr_contract_types (
  id bigserial PRIMARY KEY,
  name_ar varchar(120) NOT NULL UNIQUE,
  details text NOT NULL DEFAULT '',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hr_salary_structures (
  id bigserial PRIMARY KEY,
  name_ar varchar(120) NOT NULL UNIQUE,
  details text NOT NULL DEFAULT '',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hr_work_schedules (
  id bigserial PRIMARY KEY,
  name_ar varchar(120) NOT NULL UNIQUE,
  details text NOT NULL DEFAULT '',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS manager_employee_id int REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_type_id bigint REFERENCES hr_contract_types(id) ON DELETE SET NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary_structure_id bigint REFERENCES hr_salary_structures(id) ON DELETE SET NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_schedule_id bigint REFERENCES hr_work_schedules(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(manager_employee_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_contract_types, hr_salary_structures, hr_work_schedules TO erpx_app;
GRANT USAGE, SELECT ON SEQUENCE hr_contract_types_id_seq, hr_salary_structures_id_seq, hr_work_schedules_id_seq TO erpx_app;
