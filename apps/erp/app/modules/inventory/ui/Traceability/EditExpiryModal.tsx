// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DatePicker,
  Hidden,
  Submit,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { trackedEntityExpiryValidator } from "~/modules/inventory/inventory.models";
import { path } from "~/utils/path";

type EditExpiryModalProps = {
  trackedEntityId: string;
  /** Existing expirationDate (YYYY-MM-DD) — used to pre-fill the date input. */
  expirationDate?: string | null;
  retestDate?: string | null;
  /** Optional readable label for the entity, shown in the modal header. */
  label?: string | null;
  open: boolean;
  onClose: () => void;
};

/**
 * Manual override of a tracked entity's expirationDate. The submission
 * goes through `path.to.trackedEntityExpiry`, which records the prior
 * value, the new value, and the reason on the entity's attributes JSONB
 * (under `expiryOverrides`). The trace popover can surface that history
 * later.
 */
export function EditExpiryModal({
  trackedEntityId,
  expirationDate,
  retestDate,
  label,
  open,
  onClose
}: EditExpiryModalProps) {
  const { t } = useLingui();

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()}>
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.trackedEntityExpiry}
          validator={trackedEntityExpiryValidator}
          defaultValues={{
            trackedEntityId,
            expirationDate: expirationDate ?? "",
            retestDate: retestDate ?? "",
            reason: ""
          }}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Edit lot dates (SkuuOS)</Trans>
            </ModalTitle>
            {label && (
              <ModalDescription>
                <Trans>Update expiration and retest dates for {label}.</Trans>
              </ModalDescription>
            )}
          </ModalHeader>
          <ModalBody>
            <Hidden name="trackedEntityId" />
            <div className="flex flex-col gap-4">
              <DatePicker
                name="expirationDate"
                label={t`Expiration date`}
                termId="traceability-expiration-edit-date"
                helperText={t`Pick a date or leave blank to clear it.`}
              />
              <DatePicker
                name="retestDate"
                label={t`Retest date`}
                helperText={t`When this lot must be retested (SkuuOS). Leave blank to clear.`}
              />
              <TextArea
                name="reason"
                label={t`Reason`}
                placeholder={t`Why is the expiration being changed?`}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
