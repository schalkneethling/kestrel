ALTER TABLE `role_ledger` ADD `not_interested_at` text;--> statement-breakpoint
CREATE INDEX `role_ledger_not_interested_idx` ON `role_ledger` (`not_interested_at`);