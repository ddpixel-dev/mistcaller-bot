-- FR-023: the kind of content inside its forum type. The list lives in code (ADR 0010).
alter table content add column kind text not null default 'other';
